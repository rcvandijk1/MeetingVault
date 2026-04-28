using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public interface IMeetingDetector
{
    MeetingDetectionResult Detect();
}

public interface IActiveWindowService
{
    /// <summary>Returns (processName, windowTitle) for the current foreground window.</summary>
    (string ProcessName, string WindowTitle) GetForegroundWindow();
}

public interface IMeetingDetectionMonitor : IDisposable
{
    event EventHandler<MeetingDetectionResult>? DetectionChanged;

    MeetingDetectionResult Latest { get; }

    void Start();

    void Stop();
}
