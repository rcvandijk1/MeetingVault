using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public class DiarizationRequest
{
    public string CombinedAudioPath { get; set; } = string.Empty;
    public string? MicrophoneAudioPath { get; set; }
    public string? LoopbackAudioPath { get; set; }
    public IReadOnlyList<TranscriptionSegment> Segments { get; set; } = Array.Empty<TranscriptionSegment>();
    public string SpeakersFolder { get; set; } = string.Empty;
}

public class DiarizationResult
{
    public IReadOnlyList<Speaker> Speakers { get; set; } = Array.Empty<Speaker>();
    public IReadOnlyList<TranscriptionSegment> AnnotatedSegments { get; set; } = Array.Empty<TranscriptionSegment>();
    public string EngineName { get; set; } = string.Empty;
    public string Notes { get; set; } = string.Empty;
}

public interface ISpeakerDiarizationService
{
    string EngineName { get; }

    Task<DiarizationResult> DiarizeAsync(DiarizationRequest request, CancellationToken ct = default);
}

public interface ISpeakerStore
{
    Task WriteAsync(string path, IReadOnlyList<Speaker> speakers, CancellationToken ct = default);

    Task<IReadOnlyList<Speaker>> ReadAsync(string path, CancellationToken ct = default);
}

public interface ISpeakerProfileStore
{
    Task<IReadOnlyList<SpeakerProfile>> ListAsync(CancellationToken ct = default);

    Task SaveAsync(SpeakerProfile profile, CancellationToken ct = default);

    Task DeleteAsync(string speakerId, CancellationToken ct = default);

    Task<SpeakerProfile?> GetAsync(string speakerId, CancellationToken ct = default);
}
