using System.Text.Json;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Persistence;

public class JsonSpeakerStore : ISpeakerStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task WriteAsync(string path, IReadOnlyList<Speaker> speakers, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(speakers, JsonOptions), ct);
    }

    public async Task<IReadOnlyList<Speaker>> ReadAsync(string path, CancellationToken ct = default)
    {
        if (!File.Exists(path)) return Array.Empty<Speaker>();
        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<List<Speaker>>(json, JsonOptions) ?? new List<Speaker>();
    }
}
