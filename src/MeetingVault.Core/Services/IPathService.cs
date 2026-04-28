using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public interface IPathService
{
    /// <summary>Documents\MeetingVault (or override).</summary>
    string RootFolder { get; }

    string MeetingsFolder { get; }

    string SpeakerProfilesFolder { get; }

    string DatabaseFolder { get; }

    string DatabasePath { get; }

    string LogsFolder { get; }

    void EnsureFoldersExist();

    /// <summary>
    /// Builds the per-meeting folder path:
    /// Meetings\YYYY\MM\YYYY-MM-DD_HH-mm_Subject_Platform.
    /// Subject is sanitized and truncated; collisions get a numeric suffix.
    /// </summary>
    string BuildMeetingFolderPath(MeetingSession session);

    string SanitizeFolderSegment(string? segment, string fallback);
}
