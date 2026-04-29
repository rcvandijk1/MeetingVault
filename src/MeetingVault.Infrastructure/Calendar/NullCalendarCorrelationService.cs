using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Calendar;

/// <summary>
/// MVP fallback: returns no match. Real implementations (Outlook MAPI via
/// Microsoft.Office.Interop.Outlook, Microsoft Graph, Google Calendar API)
/// should replace this in DI when a calendar source is available.
/// </summary>
public class NullCalendarCorrelationService : ICalendarCorrelationService
{
    public string ProviderName => "None";

    public Task<CalendarMatch?> FindMatchAsync(DateTime startTime, DateTime endTime, CancellationToken ct = default)
        => Task.FromResult<CalendarMatch?>(null);
}
