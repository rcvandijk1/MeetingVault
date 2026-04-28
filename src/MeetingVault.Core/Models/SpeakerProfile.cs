namespace MeetingVault.Core.Models;

public class SpeakerProfile
{
    public string SpeakerId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public List<string> Aliases { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public bool VoiceProfileAvailable { get; set; }

    public string Notes { get; set; } = string.Empty;
}
