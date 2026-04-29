using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public interface IMeetingSessionStore
{
    Task<MeetingSession> CreateAsync(MeetingSession session, CancellationToken ct = default);

    Task UpdateAsync(MeetingSession session, CancellationToken ct = default);

    Task<MeetingSession?> GetAsync(string sessionId, CancellationToken ct = default);

    Task<IReadOnlyList<MeetingSession>> ListAsync(MeetingHistoryFilter? filter = null, CancellationToken ct = default);

    Task DeleteAsync(string sessionId, CancellationToken ct = default);

    /// <summary>Replace all transcript segments for a session.</summary>
    Task ReplaceSegmentsAsync(string sessionId, IReadOnlyList<TranscriptionSegment> segments, CancellationToken ct = default);

    /// <summary>Replace all speakers for a session.</summary>
    Task ReplaceSpeakersAsync(string sessionId, IReadOnlyList<Speaker> speakers, CancellationToken ct = default);

    /// <summary>
    /// Full-text-ish search over transcript segments. Results are returned per
    /// session with a snippet of the first matching segment.
    /// </summary>
    Task<IReadOnlyList<TranscriptSearchHit>> SearchTranscriptsAsync(string query, CancellationToken ct = default);
}

public class MeetingHistoryFilter
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public string? Platform { get; set; }
    public string? SubjectContains { get; set; }
}

public class TranscriptSearchHit
{
    public string SessionId { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Platform { get; set; } = string.Empty;
    public DateTime StartTime { get; set; }
    public string Snippet { get; set; } = string.Empty;
    public TimeSpan SegmentStart { get; set; }
    public string? SpeakerName { get; set; }
    public int MatchCount { get; set; }
}
