using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public interface IMeetingSessionStore
{
    Task<MeetingSession> CreateAsync(MeetingSession session, CancellationToken ct = default);

    Task UpdateAsync(MeetingSession session, CancellationToken ct = default);

    Task<MeetingSession?> GetAsync(string sessionId, CancellationToken ct = default);

    Task<IReadOnlyList<MeetingSession>> ListAsync(MeetingHistoryFilter? filter = null, CancellationToken ct = default);

    Task DeleteAsync(string sessionId, CancellationToken ct = default);
}

public class MeetingHistoryFilter
{
    public DateTime? From { get; set; }
    public DateTime? To { get; set; }
    public string? Platform { get; set; }
    public string? SubjectContains { get; set; }
}
