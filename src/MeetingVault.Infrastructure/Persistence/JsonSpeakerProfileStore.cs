using System.Text.Json;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Persistence;

public class JsonSpeakerProfileStore : ISpeakerProfileStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    private readonly IPathService _paths;

    public JsonSpeakerProfileStore(IPathService paths)
    {
        _paths = paths;
    }

    public async Task<IReadOnlyList<SpeakerProfile>> ListAsync(CancellationToken ct = default)
    {
        var folder = _paths.SpeakerProfilesFolder;
        if (!Directory.Exists(folder)) return Array.Empty<SpeakerProfile>();

        var results = new List<SpeakerProfile>();
        foreach (var file in Directory.EnumerateFiles(folder, "*.json"))
        {
            try
            {
                var json = await File.ReadAllTextAsync(file, ct);
                var profile = JsonSerializer.Deserialize<SpeakerProfile>(json, JsonOptions);
                if (profile != null) results.Add(profile);
            }
            catch
            {
                // Skip unreadable profile files; the user can re-create them.
            }
        }
        return results;
    }

    public async Task SaveAsync(SpeakerProfile profile, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_paths.SpeakerProfilesFolder);
        profile.UpdatedAt = DateTime.UtcNow;
        var path = Path.Combine(_paths.SpeakerProfilesFolder, $"{Sanitize(profile.SpeakerId)}.json");
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(profile, JsonOptions), ct);
    }

    public Task DeleteAsync(string speakerId, CancellationToken ct = default)
    {
        var path = Path.Combine(_paths.SpeakerProfilesFolder, $"{Sanitize(speakerId)}.json");
        if (File.Exists(path)) File.Delete(path);
        return Task.CompletedTask;
    }

    public async Task<SpeakerProfile?> GetAsync(string speakerId, CancellationToken ct = default)
    {
        var path = Path.Combine(_paths.SpeakerProfilesFolder, $"{Sanitize(speakerId)}.json");
        if (!File.Exists(path)) return null;
        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<SpeakerProfile>(json, JsonOptions);
    }

    private static string Sanitize(string input)
    {
        var invalid = Path.GetInvalidFileNameChars();
        return new string(input.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
    }
}
