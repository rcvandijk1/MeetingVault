using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public enum RecordingCoordinatorState
{
    Idle,
    Detected,
    Recording,
    Stopped,
    Transcribing,
    AwaitingSpeakerReview,
    Completed,
    Failed
}

/// <summary>
/// Orchestrates a full meeting lifecycle: create folder → start audio capture →
/// stop → write metadata → transcribe → diarize → expose for speaker review.
/// View models talk to this service rather than to the underlying audio /
/// transcription services directly.
/// </summary>
public interface IRecordingCoordinator
{
    RecordingCoordinatorState State { get; }

    MeetingSession? Current { get; }

    event EventHandler<RecordingCoordinatorState>? StateChanged;

    event EventHandler<string>? StatusMessage;

    Task<MeetingSession> StartAsync(MeetingDetectionResult? detection, CancellationToken ct = default);

    Task<MeetingSession> StopAsync(CancellationToken ct = default);

    Task<MeetingSession> TranscribeAsync(MeetingSession session, CancellationToken ct = default);
}
