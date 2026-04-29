using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

/// <summary>
/// Correlate a recorded meeting with a calendar entry to fill in subject,
/// organizer and attendees. Implementations wrap Outlook (MAPI / Graph) or
/// Google Calendar; for the MVP a no-op fallback is used.
/// </summary>
public interface ICalendarCorrelationService
{
    string ProviderName { get; }

    /// <summary>
    /// Returns the best-matching calendar event (if any) within a small
    /// window around the supplied time. Implementations should not block on
    /// network calls without honouring the cancellation token.
    /// </summary>
    Task<CalendarMatch?> FindMatchAsync(DateTime startTime, DateTime endTime, CancellationToken ct = default);
}

public class CalendarMatch
{
    public string Subject { get; set; } = string.Empty;
    public string? Organizer { get; set; }
    public List<string> Attendees { get; set; } = new();
    public string? MeetingUrl { get; set; }
    public DateTime EventStart { get; set; }
    public DateTime EventEnd { get; set; }
}
