namespace MeetingVault.Core.Models;

public class Speaker
{
    public string SpeakerId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = "Unknown Speaker";

    public bool IsKnown { get; set; }

    public double Confidence { get; set; }

    public string? FirstSeenAt { get; set; }

    public double TotalSpeakingSeconds { get; set; }

    public string? SampleAudioPath { get; set; }

    /// <summary>
    /// When set, this speaker has been merged into another. Callers should
    /// resolve <see cref="MergedIntoSpeakerId"/> before rendering the speaker.
    /// </summary>
    public string? MergedIntoSpeakerId { get; set; }

    public bool IsMe { get; set; }

    public bool Ignored { get; set; }
}
