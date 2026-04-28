using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Detection;

/// <summary>
/// Periodically polls <see cref="IMeetingDetector"/> on a worker thread and
/// raises an event whenever the result transitions in a meaningful way (e.g.
/// detected→not-detected, or platform change). Uses the user-configurable
/// <c>DetectionPollMs</c> interval so users can throttle on battery.
/// </summary>
public sealed class MeetingDetectionMonitor : IMeetingDetectionMonitor
{
    private readonly IMeetingDetector _detector;
    private readonly ISettingsStore _settings;
    private readonly ILogger<MeetingDetectionMonitor> _logger;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private readonly object _lock = new();

    public MeetingDetectionMonitor(IMeetingDetector detector, ISettingsStore settings, ILogger<MeetingDetectionMonitor> logger)
    {
        _detector = detector;
        _settings = settings;
        _logger = logger;
        Latest = MeetingDetectionResult.None();
    }

    public event EventHandler<MeetingDetectionResult>? DetectionChanged;

    public MeetingDetectionResult Latest { get; private set; }

    public void Start()
    {
        lock (_lock)
        {
            if (_loopTask != null) return;
            _cts = new CancellationTokenSource();
            var token = _cts.Token;
            _loopTask = Task.Run(() => Loop(token), token);
        }
    }

    public void Stop()
    {
        lock (_lock)
        {
            _cts?.Cancel();
            _loopTask = null;
        }
    }

    public void Dispose() => Stop();

    private async Task Loop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                var pollMs = Math.Max(1000, _settings.Current.DetectionPollMs);
                var result = _detector.Detect();
                if (HasChanged(Latest, result))
                {
                    Latest = result;
                    DetectionChanged?.Invoke(this, result);
                    _logger.LogInformation("Meeting detection: {Platform} detected={Detected} reason={Reason}",
                        result.Platform, result.IsMeetingDetected, result.DetectionReason);
                }
                await Task.Delay(pollMs, token);
            }
            catch (TaskCanceledException) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Detection loop iteration failed.");
                try { await Task.Delay(5000, token); } catch { break; }
            }
        }
    }

    private static bool HasChanged(MeetingDetectionResult a, MeetingDetectionResult b)
    {
        return a.IsMeetingDetected != b.IsMeetingDetected
               || !string.Equals(a.Platform, b.Platform, StringComparison.Ordinal)
               || !string.Equals(a.WindowTitle, b.WindowTitle, StringComparison.Ordinal);
    }
}
