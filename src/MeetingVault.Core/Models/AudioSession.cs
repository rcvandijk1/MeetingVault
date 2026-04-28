namespace MeetingVault.Core.Models;

public enum AudioCaptureState
{
    Idle,
    Starting,
    Recording,
    Stopping,
    Stopped,
    Failed
}

/// <summary>
/// Represents a single audio capture session. The recorder produces up to three
/// WAV files (microphone, system loopback, optional combined mix) all anchored
/// to <see cref="StartedAt"/> so callers can re-align the streams later.
/// </summary>
public class AudioSession
{
    public string SessionId { get; set; } = Guid.NewGuid().ToString("N");

    public DateTime StartedAt { get; set; } = DateTime.Now;

    public DateTime? StoppedAt { get; set; }

    public string? MicrophoneDeviceId { get; set; }

    public string? MicrophoneDeviceName { get; set; }

    public string? RenderDeviceId { get; set; }

    public string? RenderDeviceName { get; set; }

    public string? AudioMePath { get; set; }

    public string? AudioOthersPath { get; set; }

    public string? AudioCombinedPath { get; set; }

    public AudioCaptureState State { get; set; } = AudioCaptureState.Idle;

    public string? LastError { get; set; }
}
