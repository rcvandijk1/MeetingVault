using System.Text.Json;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Persistence;

public class JsonMetadataWriter : IMetadataWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public async Task WriteAsync(MeetingSession session, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(session.MetadataPath))
            session.MetadataPath = Path.Combine(session.FolderPath, "metadata.json");

        var meta = new MeetingMetadata
        {
            SessionId = session.SessionId,
            Platform = session.Platform,
            Subject = session.Subject,
            StartTime = session.StartTime,
            EndTime = session.EndTime,
            DurationSeconds = session.DurationSeconds,
            DetectedFrom = session.DetectedFrom,
            ProcessName = session.ProcessName,
            WindowTitle = session.WindowTitle,
            MeetingUrl = session.MeetingUrl,
            Organizer = session.Organizer,
            Attendees = session.Attendees,
            AudioSources = new AudioSourcesMetadata
            {
                Microphone = MakeRelative(session.FolderPath, session.AudioMePath),
                Loopback = MakeRelative(session.FolderPath, session.AudioOthersPath),
                Combined = MakeRelative(session.FolderPath, session.AudioCombinedPath)
            },
            Notes = session.Notes,
            UpdatedAt = DateTime.UtcNow
        };

        Directory.CreateDirectory(session.FolderPath);
        var json = JsonSerializer.Serialize(meta, JsonOptions);
        await File.WriteAllTextAsync(session.MetadataPath, json, ct);
    }

    public async Task<MeetingMetadata?> ReadAsync(string metadataPath, CancellationToken ct = default)
    {
        if (!File.Exists(metadataPath)) return null;
        var json = await File.ReadAllTextAsync(metadataPath, ct);
        return JsonSerializer.Deserialize<MeetingMetadata>(json, JsonOptions);
    }

    private static string? MakeRelative(string folder, string? full)
    {
        if (string.IsNullOrEmpty(full)) return null;
        try
        {
            var rel = Path.GetRelativePath(folder, full);
            return rel.Replace('\\', '/');
        }
        catch
        {
            return full;
        }
    }
}
