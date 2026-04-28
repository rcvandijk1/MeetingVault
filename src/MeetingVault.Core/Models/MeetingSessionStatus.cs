namespace MeetingVault.Core.Models;

public enum MeetingSessionStatus
{
    Detected,
    Recording,
    Stopped,
    Transcribing,
    AwaitingSpeakerReview,
    Completed,
    Failed
}
