using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;
using NAudio.Wave;
using Whisper.net;
using Whisper.net.Ggml;

namespace MeetingVault.Infrastructure.Transcription;

/// <summary>
/// Transcription via Whisper.net. The WAV input is expected to be 16kHz mono
/// (which is what our capture pipeline produces); if not, we resample on the fly
/// to a temp file so Whisper.net is happy.
///
/// If no model is configured we attempt to download the small "ggml-small" model
/// to <c>%LOCALAPPDATA%\MeetingVault\Models</c>. We never download silently —
/// the caller passes a progress sink that can surface this.
/// </summary>
public sealed class WhisperTranscriptionService : ITranscriptionService
{
    private readonly ILogger<WhisperTranscriptionService> _logger;
    private readonly ISettingsStore _settings;

    public WhisperTranscriptionService(ILogger<WhisperTranscriptionService> logger, ISettingsStore settings)
    {
        _logger = logger;
        _settings = settings;
    }

    public string EngineName => "Whisper.net";

    public async Task<IReadOnlyList<TranscriptionSegment>> TranscribeAsync(
        TranscriptionRequest request,
        IProgress<TranscriptionProgress>? progress = null,
        CancellationToken ct = default)
    {
        var modelPath = await ResolveModelAsync(request.ModelPath ?? _settings.Current.WhisperModelPath, progress, ct);

        // Ensure 16kHz mono PCM. Our pipeline already produces that; this is defensive.
        var wavPath = await EnsureWhisperReadyAsync(request.AudioPath, ct);

        progress?.Report(new TranscriptionProgress { Fraction = 0.05, Message = "Loading Whisper model" });

        using var factory = WhisperFactory.FromPath(modelPath);
        var builder = factory.CreateBuilder().WithThreads(Math.Max(1, Environment.ProcessorCount - 1));
        if (!string.Equals(request.Language, "auto", StringComparison.OrdinalIgnoreCase))
            builder = builder.WithLanguage(request.Language);
        else
            builder = builder.WithLanguageDetection();

        await using var processor = builder.Build();
        var segments = new List<TranscriptionSegment>();

        await using var fs = File.OpenRead(wavPath);
        progress?.Report(new TranscriptionProgress { Fraction = 0.1, Message = "Transcribing" });

        await foreach (var seg in processor.ProcessAsync(fs, ct))
        {
            segments.Add(new TranscriptionSegment
            {
                Start = seg.Start,
                End = seg.End,
                Text = seg.Text?.Trim() ?? string.Empty,
                Confidence = seg.Probability,
                SourceAudio = request.SourceAudio,
                NeedsSpeakerReview = true
            });
            progress?.Report(new TranscriptionProgress
            {
                Fraction = Math.Min(0.95, 0.1 + segments.Count * 0.01),
                Message = $"Transcribed {segments.Count} segments"
            });
        }

        progress?.Report(new TranscriptionProgress { Fraction = 1.0, Message = "Done" });
        _logger.LogInformation("Whisper produced {Count} segments for {Path}", segments.Count, request.AudioPath);
        return segments;
    }

    private async Task<string> ResolveModelAsync(string? configured, IProgress<TranscriptionProgress>? progress, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var modelsDir = Path.Combine(localAppData, "MeetingVault", "Models");
        Directory.CreateDirectory(modelsDir);
        var smallPath = Path.Combine(modelsDir, "ggml-small.bin");
        if (File.Exists(smallPath)) return smallPath;

        progress?.Report(new TranscriptionProgress { Fraction = 0.0, Message = "Downloading Whisper small model (first run)..." });
        _logger.LogInformation("Downloading Whisper Small model to {Path}", smallPath);

        await using var stream = await WhisperGgmlDownloader.GetGgmlModelAsync(GgmlType.Small, cancellationToken: ct);
        await using var file = File.Create(smallPath);
        await stream.CopyToAsync(file, ct);
        return smallPath;
    }

    /// <summary>
    /// Convert any input WAV to 16kHz mono 16-bit PCM if it isn't already.
    /// Returns the path to a Whisper-ready file (may be the original).
    /// </summary>
    private static Task<string> EnsureWhisperReadyAsync(string audioPath, CancellationToken ct)
    {
        return Task.Run(() =>
        {
            using var reader = new AudioFileReader(audioPath);
            if (reader.WaveFormat.SampleRate == 16000 && reader.WaveFormat.Channels == 1)
                return audioPath;

            var converted = Path.Combine(Path.GetDirectoryName(audioPath)!,
                Path.GetFileNameWithoutExtension(audioPath) + "-16k.wav");
            var target = new WaveFormat(16000, 16, 1);
            using (var resampler = new MediaFoundationResampler(reader, target) { ResamplerQuality = 60 })
            {
                WaveFileWriter.CreateWaveFile(converted, resampler);
            }
            return converted;
        }, ct);
    }
}
