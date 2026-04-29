using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Diarization;

/// <summary>
/// Picks between the stub and the python sidecar based on
/// <c>AppSettings.DiarizationEngine</c>. If the python path fails for any
/// reason — missing executable, missing model license, sidecar crash — we
/// fall back to the stub so the user still gets a transcript with manual
/// speaker review rather than no transcript at all.
/// </summary>
public class DiarizationServiceRouter : ISpeakerDiarizationService
{
    private readonly ISettingsStore _settings;
    private readonly StubSpeakerDiarizationService _stub;
    private readonly PythonDiarizationService _python;
    private readonly ILogger<DiarizationServiceRouter> _logger;

    public DiarizationServiceRouter(
        ISettingsStore settings,
        StubSpeakerDiarizationService stub,
        PythonDiarizationService python,
        ILogger<DiarizationServiceRouter> logger)
    {
        _settings = settings;
        _stub = stub;
        _python = python;
        _logger = logger;
    }

    public string EngineName =>
        string.Equals(_settings.Current.DiarizationEngine, "Python", StringComparison.OrdinalIgnoreCase)
            ? _python.EngineName
            : _stub.EngineName;

    public async Task<DiarizationResult> DiarizeAsync(DiarizationRequest request, CancellationToken ct = default)
    {
        var engine = _settings.Current.DiarizationEngine ?? "Stub";
        if (!string.Equals(engine, "Python", StringComparison.OrdinalIgnoreCase))
            return await _stub.DiarizeAsync(request, ct);

        try
        {
            return await _python.DiarizeAsync(request, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Python diarization failed; falling back to stub. The stub will not perform speaker recognition.");
            var fallback = await _stub.DiarizeAsync(request, ct);
            return new DiarizationResult
            {
                EngineName = $"{_stub.EngineName} (fallback after pyannote failure)",
                Speakers = fallback.Speakers,
                AnnotatedSegments = fallback.AnnotatedSegments,
                Notes = $"pyannote sidecar failed: {ex.Message}. Used silence-gap stub instead."
            };
        }
    }
}
