namespace MeetingVault.Core.Models;

/// <summary>
/// Represents a single meeting recording session and the artifacts it produced.
/// All paths are absolute on disk; null/empty when the corresponding artifact
/// has not been produced yet (e.g. transcript paths during the Recording phase).
/// </summary>
public class MeetingSession
{
    public string SessionId { get; set; } = Guid.NewGuid().ToString("N");

    public string Platform { get; set; } = "Unknown";

    public string Subject { get; set; } = "Untitled Meeting";

    public DateTime StartTime { get; set; } = DateTime.Now;

    public DateTime? EndTime { get; set; }

    public TimeSpan Duration => (EndTime ?? DateTime.Now) - StartTime;

    public double DurationSeconds => Duration.TotalSeconds;

    public string? WindowTitle { get; set; }

    public string? ProcessName { get; set; }

    public string FolderPath { get; set; } = string.Empty;

    public string? AudioMePath { get; set; }

    public string? AudioOthersPath { get; set; }

    public string? AudioCombinedPath { get; set; }

    public string? MetadataPath { get; set; }

    public string? TranscriptMarkdownPath { get; set; }

    public string? TranscriptJsonPath { get; set; }

    public string? SpeakersJsonPath { get; set; }

    public MeetingSessionStatus Status { get; set; } = MeetingSessionStatus.Detected;

    public string? MeetingUrl { get; set; }

    public string? Organizer { get; set; }

    public List<string> Attendees { get; set; } = new();

    public string? Notes { get; set; }

    public string? DetectedFrom { get; set; }
}
