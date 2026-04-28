using MeetingVault.Core.Configuration;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Persistence;

public class PathService : IPathService
{
    private const int MaxSubjectLength = 60;

    private readonly ISettingsStore _settings;

    public PathService(ISettingsStore settings)
    {
        _settings = settings;
    }

    public string RootFolder
    {
        get
        {
            var overridePath = _settings.Current.RootFolderOverride;
            if (!string.IsNullOrWhiteSpace(overridePath))
                return overridePath;

            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            return Path.Combine(docs, "MeetingVault");
        }
    }

    public string MeetingsFolder => Path.Combine(RootFolder, "Meetings");
    public string SpeakerProfilesFolder => Path.Combine(RootFolder, "SpeakerProfiles");
    public string DatabaseFolder => Path.Combine(RootFolder, "Database");
    public string DatabasePath => Path.Combine(DatabaseFolder, "meetingvault.db");
    public string LogsFolder => Path.Combine(RootFolder, "Logs");

    public void EnsureFoldersExist()
    {
        Directory.CreateDirectory(RootFolder);
        Directory.CreateDirectory(MeetingsFolder);
        Directory.CreateDirectory(SpeakerProfilesFolder);
        Directory.CreateDirectory(DatabaseFolder);
        Directory.CreateDirectory(LogsFolder);
    }

    public string BuildMeetingFolderPath(MeetingSession session)
    {
        var year = session.StartTime.ToString("yyyy");
        var month = session.StartTime.ToString("MM");
        var date = session.StartTime.ToString("yyyy-MM-dd_HH-mm");
        var subject = SanitizeFolderSegment(session.Subject, "Untitled Meeting");
        var platform = SanitizeFolderSegment(session.Platform, "Unknown");

        var folderName = $"{date}_{subject}_{platform}";
        var basePath = Path.Combine(MeetingsFolder, year, month, folderName);

        // Avoid clobbering an existing folder if two meetings start in the same minute.
        var candidate = basePath;
        var i = 2;
        while (Directory.Exists(candidate))
        {
            candidate = $"{basePath}_{i}";
            i++;
        }

        return candidate;
    }

    public string SanitizeFolderSegment(string? segment, string fallback)
    {
        if (string.IsNullOrWhiteSpace(segment))
            return fallback;

        var invalid = Path.GetInvalidFileNameChars().Concat(new[] { ' ', '\t', '\r', '\n' }).ToArray();
        var cleaned = new string(segment
            .Select(c => Array.IndexOf(invalid, c) >= 0 ? '_' : c)
            .ToArray())
            .Trim('_', '.');

        if (string.IsNullOrWhiteSpace(cleaned))
            return fallback;

        if (cleaned.Length > MaxSubjectLength)
            cleaned = cleaned[..MaxSubjectLength].TrimEnd('_', '.');

        return cleaned;
    }
}
