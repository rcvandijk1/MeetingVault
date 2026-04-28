namespace MeetingVault.Core.Models;

public enum TranscriptSourceAudio
{
    Combined,
    Microphone,
    Loopback
}

public class TranscriptionSegment
{
    public string SegmentId { get; set; } = Guid.NewGuid().ToString("N");

    public TimeSpan Start { get; set; }

    public TimeSpan End { get; set; }

    public string? SpeakerId { get; set; }

    public string? SpeakerName { get; set; }

    public string Text { get; set; } = string.Empty;

    public double Confidence { get; set; }

    public TranscriptSourceAudio SourceAudio { get; set; } = TranscriptSourceAudio.Combined;

    public bool NeedsSpeakerReview { get; set; }
}
