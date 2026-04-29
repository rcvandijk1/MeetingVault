using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure;

/// <summary>
/// Implements the meeting lifecycle. Phases run sequentially; failures are
/// logged and surfaced via <see cref="StatusMessage"/> rather than crashing the
/// app — a half-recorded meeting still has audio on disk that the user can
/// transcribe later from the history screen.
/// </summary>
public class RecordingCoordinator : IRecordingCoordinator
{
    private readonly IPathService _paths;
    private readonly IAudioCaptureService _audio;
    private readonly IMetadataWriter _metadataWriter;
    private readonly ITranscriptionService _transcriber;
    private readonly ITranscriptWriter _transcriptWriter;
    private readonly ISpeakerDiarizationService _diarization;
    private readonly ISpeakerStore _speakerStore;
    private readonly IMeetingSessionStore _sessionStore;
    private readonly ISettingsStore _settings;
    private readonly ICalendarCorrelationService _calendar;
    private readonly ILogger<RecordingCoordinator> _logger;

    public RecordingCoordinator(
        IPathService paths,
        IAudioCaptureService audio,
        IMetadataWriter metadataWriter,
        ITranscriptionService transcriber,
        ITranscriptWriter transcriptWriter,
        ISpeakerDiarizationService diarization,
        ISpeakerStore speakerStore,
        IMeetingSessionStore sessionStore,
        ISettingsStore settings,
        ICalendarCorrelationService calendar,
        ILogger<RecordingCoordinator> logger)
    {
        _paths = paths;
        _audio = audio;
        _metadataWriter = metadataWriter;
        _transcriber = transcriber;
        _transcriptWriter = transcriptWriter;
        _diarization = diarization;
        _speakerStore = speakerStore;
        _sessionStore = sessionStore;
        _settings = settings;
        _calendar = calendar;
        _logger = logger;
    }

    public RecordingCoordinatorState State { get; private set; } = RecordingCoordinatorState.Idle;
    public MeetingSession? Current { get; private set; }

    public event EventHandler<RecordingCoordinatorState>? StateChanged;
    public event EventHandler<string>? StatusMessage;
    public event EventHandler<double>? TranscriptionProgress;

    public async Task<MeetingSession> StartAsync(MeetingDetectionResult? detection, CancellationToken ct = default)
    {
        if (State == RecordingCoordinatorState.Recording)
            throw new InvalidOperationException("Already recording.");

        _paths.EnsureFoldersExist();

        var session = new MeetingSession
        {
            StartTime = DateTime.Now,
            Platform = detection?.IsMeetingDetected == true ? detection.Platform : "Manual",
            Subject = "Untitled Meeting",
            WindowTitle = detection?.WindowTitle,
            ProcessName = detection?.ProcessName,
            DetectedFrom = detection?.IsMeetingDetected == true ? detection.DetectionReason : "Manual start",
            Status = MeetingSessionStatus.Recording
        };
        session.FolderPath = _paths.BuildMeetingFolderPath(session);
        Directory.CreateDirectory(session.FolderPath);

        Current = session;
        Notify(RecordingCoordinatorState.Recording, $"Recording started ({session.Platform}).");

        var s = _settings.Current;
        var options = new AudioCaptureOptions
        {
            FolderPath = session.FolderPath,
            CaptureMicrophone = s.SaveSeparateAudioStreams,
            CaptureLoopback = s.SaveSeparateAudioStreams,
            WriteCombined = s.SaveCombinedAudio,
            PreferredInputDeviceId = s.DefaultInputDeviceId,
            PreferredOutputDeviceId = s.DefaultOutputDeviceId
        };

        try
        {
            var audio = await _audio.StartAsync(options, ct);
            session.AudioMePath = audio.AudioMePath;
            session.AudioOthersPath = audio.AudioOthersPath;
            session.AudioCombinedPath = audio.AudioCombinedPath;

            await _metadataWriter.WriteAsync(session, ct);
            session.MetadataPath = Path.Combine(session.FolderPath, "metadata.json");
            await _sessionStore.CreateAsync(session, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start recording");
            session.Status = MeetingSessionStatus.Failed;
            Notify(RecordingCoordinatorState.Failed, $"Failed to start recording: {ex.Message}");
            throw;
        }

        return session;
    }

    public async Task<MeetingSession> StopAsync(CancellationToken ct = default)
    {
        if (Current == null) throw new InvalidOperationException("No active session.");
        var session = Current;

        try
        {
            await _audio.StopAsync(ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Audio stop failed (continuing).");
        }

        session.EndTime = DateTime.Now;
        session.Status = MeetingSessionStatus.Stopped;

        // Best-effort calendar enrichment — runs after the audio is safely on disk
        // so a slow Outlook query never delays the user pressing Stop.
        try
        {
            var match = await _calendar.FindMatchAsync(session.StartTime, session.EndTime ?? DateTime.Now, ct);
            if (match != null)
            {
                if (string.Equals(session.Subject, "Untitled Meeting", StringComparison.Ordinal))
                    session.Subject = match.Subject;
                session.Organizer ??= match.Organizer;
                if (session.Attendees.Count == 0 && match.Attendees.Count > 0)
                    session.Attendees = match.Attendees;
                session.MeetingUrl ??= match.MeetingUrl;
            }
        }
        catch (Exception ex) { _logger.LogWarning(ex, "Calendar enrichment failed."); }

        try { await _metadataWriter.WriteAsync(session, ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Metadata write on stop failed."); }

        try { await _sessionStore.UpdateAsync(session, ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Session store update on stop failed."); }

        Notify(RecordingCoordinatorState.Stopped, "Recording stopped.");
        return session;
    }

    public async Task<MeetingSession> TranscribeAsync(MeetingSession session, CancellationToken ct = default)
    {
        Notify(RecordingCoordinatorState.Transcribing, "Transcribing...");
        session.Status = MeetingSessionStatus.Transcribing;
        try { await _sessionStore.UpdateAsync(session, ct); } catch { }

        var audio = ChooseAudioForTranscription(session);
        if (audio == null)
        {
            session.Status = MeetingSessionStatus.Failed;
            Notify(RecordingCoordinatorState.Failed, "No audio file available for transcription.");
            return session;
        }

        try
        {
            var progress = new Progress<TranscriptionProgress>(p =>
            {
                StatusMessage?.Invoke(this, $"Transcribing: {(int)(p.Fraction * 100)}% — {p.Message}");
                this.TranscriptionProgress?.Invoke(this, p.Fraction);
            });

            var segments = await _transcriber.TranscribeAsync(new TranscriptionRequest
            {
                AudioPath = audio,
                Language = _settings.Current.WhisperLanguage,
                ModelPath = _settings.Current.WhisperModelPath,
                SourceAudio = TranscriptSourceAudio.Combined
            }, progress, ct);

            // Diarize. Stub by default; real engine if configured.
            Notify(RecordingCoordinatorState.Transcribing, "Detecting speakers...");
            var speakersFolder = Path.Combine(session.FolderPath, "speakers");
            var diar = await _diarization.DiarizeAsync(new DiarizationRequest
            {
                CombinedAudioPath = session.AudioCombinedPath ?? audio,
                MicrophoneAudioPath = session.AudioMePath,
                LoopbackAudioPath = session.AudioOthersPath,
                Segments = segments,
                SpeakersFolder = speakersFolder
            }, ct);

            session.TranscriptJsonPath = Path.Combine(session.FolderPath, "transcript.json");
            session.SpeakersJsonPath = Path.Combine(session.FolderPath, "speakers.json");
            session.TranscriptMarkdownPath = Path.Combine(session.FolderPath, "transcript.md");

            await _transcriptWriter.WriteJsonAsync(session.TranscriptJsonPath, diar.AnnotatedSegments, ct);
            await _speakerStore.WriteAsync(session.SpeakersJsonPath, diar.Speakers, ct);
            await _transcriptWriter.WriteMarkdownAsync(session.TranscriptMarkdownPath, session,
                diar.AnnotatedSegments, diar.Speakers, ct);

            // Index in SQLite so the search view and segment-level history can find them.
            try
            {
                await _sessionStore.ReplaceSegmentsAsync(session.SessionId, diar.AnnotatedSegments, ct);
                await _sessionStore.ReplaceSpeakersAsync(session.SessionId, diar.Speakers, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SQLite index update failed (JSON files are still authoritative).");
            }

            // Optional cleanup: discard raw mic/loop WAVs once we've successfully transcribed.
            if (!_settings.Current.KeepRawAudio)
                TryDeleteRawAudio(session);

            session.Status = MeetingSessionStatus.AwaitingSpeakerReview;
            try { await _sessionStore.UpdateAsync(session, ct); } catch { }
            Notify(RecordingCoordinatorState.AwaitingSpeakerReview,
                $"Transcript ready — {diar.Speakers.Count} speakers detected. Review names.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Transcription failed.");
            session.Status = MeetingSessionStatus.Failed;
            Notify(RecordingCoordinatorState.Failed, $"Transcription failed: {ex.Message}");
        }

        return session;
    }

    private void TryDeleteRawAudio(MeetingSession session)
    {
        // Only remove the per-source streams; the combined mix stays as the
        // canonical record of what was said.
        foreach (var path in new[] { session.AudioMePath, session.AudioOthersPath })
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) continue;
            try { File.Delete(path); }
            catch (Exception ex) { _logger.LogWarning(ex, "Could not delete raw audio {Path}", path); }
        }
        session.AudioMePath = null;
        session.AudioOthersPath = null;
    }

    private static string? ChooseAudioForTranscription(MeetingSession s)
    {
        if (!string.IsNullOrEmpty(s.AudioCombinedPath) && File.Exists(s.AudioCombinedPath)) return s.AudioCombinedPath;
        if (!string.IsNullOrEmpty(s.AudioOthersPath) && File.Exists(s.AudioOthersPath)) return s.AudioOthersPath;
        if (!string.IsNullOrEmpty(s.AudioMePath) && File.Exists(s.AudioMePath)) return s.AudioMePath;
        return null;
    }

    private void Notify(RecordingCoordinatorState state, string message)
    {
        State = state;
        _logger.LogInformation("Coordinator: {State} — {Message}", state, message);
        StateChanged?.Invoke(this, state);
        StatusMessage?.Invoke(this, message);
    }
}
