namespace MeetingVault.Core.Models;

public class SpeakerProfile
{
    public string SpeakerId { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public List<string> Aliases { get; set; } = new();

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public bool VoiceProfileAvailable { get; set; }

    public string Notes { get; set; } = string.Empty;

    /// <summary>
    /// Persisted voice embedding for cross-meeting recognition. When present,
    /// the diarization engine compares each new speaker's embedding to this
    /// vector via cosine similarity and auto-applies <see cref="DisplayName"/>
    /// when the similarity exceeds the configured threshold.
    /// </summary>
    public float[]? Embedding { get; set; }

    /// <summary>
    /// Name of the embedding model used to produce <see cref="Embedding"/>.
    /// Profiles enrolled with one model must not be compared against
    /// embeddings from a different model — store the name so the diarization
    /// service can skip incompatible profiles.
    /// </summary>
    public string? EmbeddingModel { get; set; }
}
