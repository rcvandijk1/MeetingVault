namespace MeetingVault.Core.Models;

/// <summary>
/// Serializable metadata document persisted as <c>metadata.json</c> next to the
/// audio. Keep field names stable — they are part of the on-disk contract and
/// older meetings must remain readable when the app is updated.
/// </summary>
public class MeetingMetadata
{
    public string SessionId { get; set; } = string.Empty;
    public string Platform { get; set; } = "Unknown";
    public string Subject { get; set; } = "Untitled Meeting";
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public double DurationSeconds { get; set; }
    public string? DetectedFrom { get; set; }
    public string? ProcessName { get; set; }
    public string? WindowTitle { get; set; }
    public string? MeetingUrl { get; set; }
    public string? Organizer { get; set; }
    public List<string> Attendees { get; set; } = new();
    public AudioSourcesMetadata AudioSources { get; set; } = new();
    public string TranscriptionEngine { get; set; } = "Whisper.net";
    public string AppVersion { get; set; } = "0.1.0";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string? Notes { get; set; }
}

public class AudioSourcesMetadata
{
    public string? Microphone { get; set; }
    public string? Loopback { get; set; }
    public string? Combined { get; set; }
    public string? MicrophoneDeviceName { get; set; }
    public string? LoopbackDeviceName { get; set; }
}
