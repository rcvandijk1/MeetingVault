using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public class TranscriptionRequest
{
    public string AudioPath { get; set; } = string.Empty;
    public string? ModelPath { get; set; }
    public string Language { get; set; } = "auto";
    public TranscriptSourceAudio SourceAudio { get; set; } = TranscriptSourceAudio.Combined;
}

public class TranscriptionProgress
{
    public double Fraction { get; set; }
    public string? Message { get; set; }
}

public interface ITranscriptionService
{
    string EngineName { get; }

    Task<IReadOnlyList<TranscriptionSegment>> TranscribeAsync(
        TranscriptionRequest request,
        IProgress<TranscriptionProgress>? progress = null,
        CancellationToken ct = default);
}

public interface ITranscriptWriter
{
    Task WriteJsonAsync(string path, IReadOnlyList<TranscriptionSegment> segments, CancellationToken ct = default);

    Task<IReadOnlyList<TranscriptionSegment>> ReadJsonAsync(string path, CancellationToken ct = default);

    Task WriteMarkdownAsync(string path, MeetingSession session, IReadOnlyList<TranscriptionSegment> segments, IReadOnlyList<Speaker> speakers, CancellationToken ct = default);
}
