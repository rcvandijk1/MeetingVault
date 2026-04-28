using MeetingVault.Core.Services;

namespace MeetingVault.Infrastructure.Diarization;

/// <summary>
/// Placeholder for a future Python sidecar (e.g. pyannote.audio) that performs
/// real diarization. The intended contract is to exec a Python process with the
/// combined audio path and parse its JSON output here.
///
/// This is intentionally not wired into DI yet — it would shadow the stub
/// service and produce confusing failures if Python isn't installed.
/// </summary>
public class PythonDiarizationService : ISpeakerDiarizationService
{
    public string EngineName => "PythonSidecar";

    public Task<DiarizationResult> DiarizeAsync(DiarizationRequest request, CancellationToken ct = default)
    {
        throw new NotImplementedException(
            "PythonDiarizationService is a placeholder. Implement Python process invocation here.");
    }
}
