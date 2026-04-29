using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;
using NAudio.CoreAudioApi;
using NAudio.MediaFoundation;
using NAudio.Wave;

namespace MeetingVault.Infrastructure.Audio;

/// <summary>
/// Captures the microphone (default communications input) and the system render
/// device (default communications output via WASAPI loopback) into separate WAV
/// files. When <see cref="AudioCaptureOptions.WriteCombined"/> is set the two
/// streams are also mixed in real time into <c>audio-combined.wav</c>.
///
/// Design notes:
/// - Both inputs are resampled to a common <c>16kHz mono PCM</c> target so we
///   can mix them and feed Whisper without an extra ffmpeg step.
/// - Resampling is done via <see cref="MediaFoundationResampler"/> which is
///   adequate for speech and ships with Windows. We initialize MF on first use.
/// - The combined writer runs a small ring buffer per source so a slow callback
///   on one device never blocks the other; missing samples are zero-filled.
/// </summary>
public sealed class WasapiAudioCaptureService : IAudioCaptureService
{
    private const int TargetSampleRate = 16_000;
    private const int TargetChannels = 1;

    private readonly ILogger<WasapiAudioCaptureService> _logger;

    private WasapiCapture? _micCapture;
    private WasapiLoopbackCapture? _loopbackCapture;
    private WaveFileWriter? _micWriter;
    private WaveFileWriter? _loopWriter;
    private WaveFileWriter? _combinedWriter;

    private MediaFoundationResampler? _micResampler;
    private MediaFoundationResampler? _loopResampler;
    private BufferedWaveProvider? _micBuffer;
    private BufferedWaveProvider? _loopBuffer;
    private CancellationTokenSource? _mixCts;
    private Task? _mixTask;

    private float _lastMicLevel;
    private float _lastLoopLevel;
    private System.Timers.Timer? _levelTimer;

    private static bool _mediaFoundationInitialized;

    public WasapiAudioCaptureService(ILogger<WasapiAudioCaptureService> logger)
    {
        _logger = logger;
    }

    public AudioCaptureState State { get; private set; } = AudioCaptureState.Idle;

    public AudioSession? CurrentSession { get; private set; }

    public event EventHandler<AudioCaptureState>? StateChanged;
    public event EventHandler<AudioLevelEventArgs>? LevelsChanged;
    public event EventHandler<string>? CaptureFailed;

    public Task<AudioSession> StartAsync(AudioCaptureOptions options, CancellationToken ct = default)
    {
        if (State == AudioCaptureState.Recording || State == AudioCaptureState.Starting)
            throw new InvalidOperationException("Audio capture already in progress.");

        EnsureMediaFoundation();
        SetState(AudioCaptureState.Starting);

        var session = new AudioSession { StartedAt = DateTime.Now };
        CurrentSession = session;

        try
        {
            Directory.CreateDirectory(options.FolderPath);

            var enumerator = new MMDeviceEnumerator();

            if (options.CaptureMicrophone)
                StartMicCapture(enumerator, options, session);

            if (options.CaptureLoopback)
                StartLoopbackCapture(enumerator, options, session);

            if (options.WriteCombined && options.CaptureMicrophone && options.CaptureLoopback)
                StartCombinedMixer(options, session);

            StartLevelTimer();
            session.State = AudioCaptureState.Recording;
            SetState(AudioCaptureState.Recording);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start audio capture.");
            session.State = AudioCaptureState.Failed;
            session.LastError = ex.Message;
            SetState(AudioCaptureState.Failed);
            CaptureFailed?.Invoke(this, ex.Message);
            CleanupResources();
            throw;
        }

        return Task.FromResult(session);
    }

    public async Task<AudioSession> StopAsync(CancellationToken ct = default)
    {
        if (CurrentSession == null) throw new InvalidOperationException("No active session.");
        var session = CurrentSession;

        SetState(AudioCaptureState.Stopping);

        try { _micCapture?.StopRecording(); } catch (Exception ex) { _logger.LogWarning(ex, "mic stop"); }
        try { _loopbackCapture?.StopRecording(); } catch (Exception ex) { _logger.LogWarning(ex, "loop stop"); }

        // Give the data callbacks a moment to drain.
        await Task.Delay(150, ct);

        _mixCts?.Cancel();
        if (_mixTask != null)
        {
            try { await _mixTask.WaitAsync(TimeSpan.FromSeconds(2), ct); }
            catch { /* best-effort drain */ }
        }

        CleanupResources();

        session.StoppedAt = DateTime.Now;
        session.State = AudioCaptureState.Stopped;
        SetState(AudioCaptureState.Stopped);
        return session;
    }

    public void Dispose()
    {
        try { _micCapture?.StopRecording(); } catch { }
        try { _loopbackCapture?.StopRecording(); } catch { }
        CleanupResources();
    }

    private void StartMicCapture(MMDeviceEnumerator enumerator, AudioCaptureOptions options, AudioSession session)
    {
        var device = ResolveDevice(enumerator, DataFlow.Capture, options.PreferredInputDeviceId)
                     ?? throw new InvalidOperationException("No microphone device available.");

        session.MicrophoneDeviceId = device.ID;
        session.MicrophoneDeviceName = device.FriendlyName;
        session.AudioMePath = Path.Combine(options.FolderPath, "audio-me.wav");

        _logger.LogInformation("Starting mic capture on {Device}", device.FriendlyName);

        var capture = new WasapiCapture(device);
        var sourceFormat = capture.WaveFormat;
        var targetFormat = new WaveFormat(TargetSampleRate, 16, TargetChannels);

        var buffer = new BufferedWaveProvider(sourceFormat)
        {
            BufferDuration = TimeSpan.FromSeconds(30),
            DiscardOnBufferOverflow = true
        };
        var resampler = new MediaFoundationResampler(buffer, targetFormat) { ResamplerQuality = 60 };
        var writer = new WaveFileWriter(session.AudioMePath, targetFormat);

        capture.DataAvailable += (_, e) =>
        {
            try
            {
                if (e.BytesRecorded == 0) return;
                buffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
                _lastMicLevel = ReadPeak(e.Buffer, e.BytesRecorded, sourceFormat);

                // Drain the resampler into the writer; also publish samples to the mix buffer.
                var temp = new byte[targetFormat.AverageBytesPerSecond / 10];
                int read;
                while ((read = resampler.Read(temp, 0, temp.Length)) > 0)
                {
                    writer.Write(temp, 0, read);
                    _micBuffer?.AddSamples(temp, 0, read);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Mic data callback failed.");
                CaptureFailed?.Invoke(this, $"Microphone callback failed: {ex.Message}");
            }
        };
        capture.RecordingStopped += (_, args) =>
        {
            if (args.Exception != null)
                _logger.LogError(args.Exception, "Mic recording stopped with error.");
        };
        capture.StartRecording();

        _micCapture = capture;
        _micResampler = resampler;
        _micWriter = writer;
    }

    private void StartLoopbackCapture(MMDeviceEnumerator enumerator, AudioCaptureOptions options, AudioSession session)
    {
        var device = ResolveDevice(enumerator, DataFlow.Render, options.PreferredOutputDeviceId)
                     ?? throw new InvalidOperationException("No render device available for loopback.");

        session.RenderDeviceId = device.ID;
        session.RenderDeviceName = device.FriendlyName;
        session.AudioOthersPath = Path.Combine(options.FolderPath, "audio-others.wav");

        _logger.LogInformation("Starting loopback capture on {Device}", device.FriendlyName);

        var capture = new WasapiLoopbackCapture(device);
        var sourceFormat = capture.WaveFormat;
        var targetFormat = new WaveFormat(TargetSampleRate, 16, TargetChannels);

        var buffer = new BufferedWaveProvider(sourceFormat)
        {
            BufferDuration = TimeSpan.FromSeconds(30),
            DiscardOnBufferOverflow = true
        };
        var resampler = new MediaFoundationResampler(buffer, targetFormat) { ResamplerQuality = 60 };
        var writer = new WaveFileWriter(session.AudioOthersPath, targetFormat);

        capture.DataAvailable += (_, e) =>
        {
            try
            {
                if (e.BytesRecorded == 0) return;
                buffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
                _lastLoopLevel = ReadPeak(e.Buffer, e.BytesRecorded, sourceFormat);

                var temp = new byte[targetFormat.AverageBytesPerSecond / 10];
                int read;
                while ((read = resampler.Read(temp, 0, temp.Length)) > 0)
                {
                    writer.Write(temp, 0, read);
                    _loopBuffer?.AddSamples(temp, 0, read);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Loopback data callback failed.");
                CaptureFailed?.Invoke(this, $"Loopback callback failed: {ex.Message}");
            }
        };
        capture.RecordingStopped += (_, args) =>
        {
            if (args.Exception != null)
                _logger.LogError(args.Exception, "Loopback recording stopped with error.");
        };
        capture.StartRecording();

        _loopbackCapture = capture;
        _loopResampler = resampler;
        _loopWriter = writer;
    }

    private void StartCombinedMixer(AudioCaptureOptions options, AudioSession session)
    {
        session.AudioCombinedPath = Path.Combine(options.FolderPath, "audio-combined.wav");
        var format = new WaveFormat(TargetSampleRate, 16, TargetChannels);
        _combinedWriter = new WaveFileWriter(session.AudioCombinedPath, format);

        _micBuffer = new BufferedWaveProvider(format)
        {
            BufferDuration = TimeSpan.FromSeconds(60),
            DiscardOnBufferOverflow = true,
            ReadFully = true
        };
        _loopBuffer = new BufferedWaveProvider(format)
        {
            BufferDuration = TimeSpan.FromSeconds(60),
            DiscardOnBufferOverflow = true,
            ReadFully = true
        };

        _mixCts = new CancellationTokenSource();
        var token = _mixCts.Token;
        _mixTask = Task.Run(() => RunMixLoop(format, token), token);
    }

    private void RunMixLoop(WaveFormat format, CancellationToken token)
    {
        var chunkBytes = format.AverageBytesPerSecond / 20; // 50ms
        if (chunkBytes % 2 != 0) chunkBytes++;
        var micChunk = new byte[chunkBytes];
        var loopChunk = new byte[chunkBytes];
        var mixed = new byte[chunkBytes];

        try
        {
            while (!token.IsCancellationRequested)
            {
                // ReadFully=true means Read returns chunkBytes (zero-filled if no data); pace ourselves.
                Thread.Sleep(40);
                var micRead = _micBuffer?.Read(micChunk, 0, chunkBytes) ?? 0;
                var loopRead = _loopBuffer?.Read(loopChunk, 0, chunkBytes) ?? 0;
                var len = Math.Max(micRead, loopRead);
                if (len == 0) continue;

                for (int i = 0; i + 1 < len; i += 2)
                {
                    short m = (short)(micChunk[i] | (micChunk[i + 1] << 8));
                    short l = (short)(loopChunk[i] | (loopChunk[i + 1] << 8));
                    int sum = m + l;
                    if (sum > short.MaxValue) sum = short.MaxValue;
                    if (sum < short.MinValue) sum = short.MinValue;
                    mixed[i] = (byte)(sum & 0xFF);
                    mixed[i + 1] = (byte)((sum >> 8) & 0xFF);
                }

                _combinedWriter?.Write(mixed, 0, len);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mix loop failed.");
            CaptureFailed?.Invoke(this, $"Combined mix failed: {ex.Message}");
        }
    }

    private void StartLevelTimer()
    {
        _levelTimer = new System.Timers.Timer(120) { AutoReset = true };
        _levelTimer.Elapsed += (_, _) => LevelsChanged?.Invoke(this,
            new AudioLevelEventArgs { MicLevel = _lastMicLevel, LoopbackLevel = _lastLoopLevel });
        _levelTimer.Start();
    }

    private void CleanupResources()
    {
        try { _levelTimer?.Stop(); } catch { }
        _levelTimer?.Dispose(); _levelTimer = null;

        try { _micWriter?.Flush(); } catch { }
        try { _loopWriter?.Flush(); } catch { }
        try { _combinedWriter?.Flush(); } catch { }

        _micWriter?.Dispose(); _micWriter = null;
        _loopWriter?.Dispose(); _loopWriter = null;
        _combinedWriter?.Dispose(); _combinedWriter = null;

        _micResampler?.Dispose(); _micResampler = null;
        _loopResampler?.Dispose(); _loopResampler = null;

        _micCapture?.Dispose(); _micCapture = null;
        _loopbackCapture?.Dispose(); _loopbackCapture = null;

        _mixCts?.Dispose(); _mixCts = null;
        _mixTask = null;
        _micBuffer = null;
        _loopBuffer = null;

        _lastMicLevel = 0;
        _lastLoopLevel = 0;
    }

    private static MMDevice? ResolveDevice(MMDeviceEnumerator enumerator, DataFlow flow, string? preferredId)
    {
        if (!string.IsNullOrWhiteSpace(preferredId))
        {
            try
            {
                var d = enumerator.GetDevice(preferredId);
                if (d != null && d.State == DeviceState.Active) return d;
            }
            catch
            {
                // Fall through to defaults if the saved id is no longer valid.
            }
        }

        try { return enumerator.GetDefaultAudioEndpoint(flow, Role.Communications); }
        catch
        {
            try { return enumerator.GetDefaultAudioEndpoint(flow, Role.Multimedia); }
            catch { return null; }
        }
    }

    private static float ReadPeak(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            float peak = 0;
            for (int i = 0; i + 3 < bytesRecorded; i += 4)
            {
                var s = BitConverter.ToSingle(buffer, i);
                var a = Math.Abs(s);
                if (a > peak) peak = a;
            }
            return Math.Min(peak, 1f);
        }

        if (format.Encoding == WaveFormatEncoding.Pcm && format.BitsPerSample == 16)
        {
            float peak = 0;
            for (int i = 0; i + 1 < bytesRecorded; i += 2)
            {
                short s = (short)(buffer[i] | (buffer[i + 1] << 8));
                var a = Math.Abs(s) / 32768f;
                if (a > peak) peak = a;
            }
            return peak;
        }

        return 0;
    }

    private void EnsureMediaFoundation()
    {
        if (_mediaFoundationInitialized) return;
        MediaFoundationApi.Startup();
        _mediaFoundationInitialized = true;
    }

    private void SetState(AudioCaptureState state)
    {
        State = state;
        StateChanged?.Invoke(this, state);
    }
}
