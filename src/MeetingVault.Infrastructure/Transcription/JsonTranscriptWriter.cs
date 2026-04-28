using System.Globalization;
using System.Text;
using System.Text.Json;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Transcription;

public class JsonTranscriptWriter : ITranscriptWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public async Task WriteJsonAsync(string path, IReadOnlyList<TranscriptionSegment> segments, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        await File.WriteAllTextAsync(path, JsonSerializer.Serialize(segments, JsonOptions), ct);
    }

    public async Task<IReadOnlyList<TranscriptionSegment>> ReadJsonAsync(string path, CancellationToken ct = default)
    {
        if (!File.Exists(path)) return Array.Empty<TranscriptionSegment>();
        var json = await File.ReadAllTextAsync(path, ct);
        return JsonSerializer.Deserialize<List<TranscriptionSegment>>(json, JsonOptions) ?? new List<TranscriptionSegment>();
    }

    public async Task WriteMarkdownAsync(string path, MeetingSession session,
        IReadOnlyList<TranscriptionSegment> segments, IReadOnlyList<Speaker> speakers, CancellationToken ct = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        var speakerMap = speakers.ToDictionary(s => s.SpeakerId, s => s);
        var sb = new StringBuilder();
        sb.AppendLine("# Meeting Transcript");
        sb.AppendLine();
        sb.AppendLine("## Metadata");
        sb.AppendLine($"- Subject: {session.Subject}");
        sb.AppendLine($"- Platform: {session.Platform}");
        sb.AppendLine($"- Date: {session.StartTime:yyyy-MM-dd}");
        sb.AppendLine($"- Start: {session.StartTime:HH:mm:ss}");
        sb.AppendLine($"- End: {(session.EndTime.HasValue ? session.EndTime.Value.ToString("HH:mm:ss") : "—")}");
        sb.AppendLine($"- Duration: {FormatDuration(session.Duration)}");
        sb.AppendLine($"- Organizer: {session.Organizer ?? "—"}");
        sb.AppendLine($"- Attendees: {(session.Attendees.Count == 0 ? "—" : string.Join(", ", session.Attendees))}");
        sb.AppendLine();
        sb.AppendLine("## Transcript");
        sb.AppendLine();

        foreach (var seg in segments)
        {
            var ts = FormatTimestamp(seg.Start);
            var name = ResolveDisplayName(seg, speakerMap);
            sb.AppendLine($"[{ts}] {name}:");
            sb.AppendLine(seg.Text);
            sb.AppendLine();
        }

        await File.WriteAllTextAsync(path, sb.ToString(), ct);
    }

    private static string ResolveDisplayName(TranscriptionSegment seg, Dictionary<string, Speaker> speakers)
    {
        if (!string.IsNullOrEmpty(seg.SpeakerName)) return seg.SpeakerName!;
        if (!string.IsNullOrEmpty(seg.SpeakerId) && speakers.TryGetValue(seg.SpeakerId!, out var sp))
            return sp.DisplayName;
        return "Unknown Speaker";
    }

    private static string FormatTimestamp(TimeSpan ts) =>
        ts.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture);

    private static string FormatDuration(TimeSpan d)
    {
        if (d < TimeSpan.Zero) d = TimeSpan.Zero;
        return d.ToString(@"hh\:mm\:ss", CultureInfo.InvariantCulture);
    }
}
