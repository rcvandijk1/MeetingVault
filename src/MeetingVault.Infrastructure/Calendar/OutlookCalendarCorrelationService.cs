using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Calendar;

/// <summary>
/// Placeholder for Outlook (MAPI / Graph) calendar correlation.
///
/// To implement:
///   - Add Microsoft.Office.Interop.Outlook (or Microsoft.Graph + MSAL).
///   - Query the default calendar for events overlapping [startTime, endTime]
///     plus a small buffer (e.g. ±10 minutes).
///   - Return the event whose subject/Teams URL/attendees overlap best.
///
/// Wire this implementation in App.xaml.cs DI in place of
/// <see cref="NullCalendarCorrelationService"/> once it's ready.
/// </summary>
public class OutlookCalendarCorrelationService : ICalendarCorrelationService
{
    public string ProviderName => "Outlook (placeholder)";

    public Task<CalendarMatch?> FindMatchAsync(DateTime startTime, DateTime endTime, CancellationToken ct = default)
    {
        throw new NotImplementedException(
            "OutlookCalendarCorrelationService is a placeholder. Replace with a MAPI or Graph implementation.");
    }
}
