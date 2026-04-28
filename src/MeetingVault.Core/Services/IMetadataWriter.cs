using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public interface IMetadataWriter
{
    Task WriteAsync(MeetingSession session, CancellationToken ct = default);

    Task<MeetingMetadata?> ReadAsync(string metadataPath, CancellationToken ct = default);
}
