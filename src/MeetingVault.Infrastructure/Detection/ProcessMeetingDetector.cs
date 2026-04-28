using System.Diagnostics;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Detection;

/// <summary>
/// Conservative meeting detector. Looks at running processes and the current
/// foreground window title and combines the two signals — we only return a
/// high confidence result when both agree, to avoid auto-starting a recording
/// just because Teams.exe is sitting in the tray.
/// </summary>
public class ProcessMeetingDetector : IMeetingDetector
{
    private static readonly string[] TeamsProcessNames = { "ms-teams", "Teams" };
    private static readonly string[] ZoomProcessNames = { "Zoom", "CptHost", "ZoomClips" };
    private static readonly string[] BrowserProcessNames = { "chrome", "msedge" };

    private readonly IActiveWindowService _activeWindow;
    private readonly ILogger<ProcessMeetingDetector> _logger;

    public ProcessMeetingDetector(IActiveWindowService activeWindow, ILogger<ProcessMeetingDetector> logger)
    {
        _activeWindow = activeWindow;
        _logger = logger;
    }

    public MeetingDetectionResult Detect()
    {
        try
        {
            var (procName, title) = _activeWindow.GetForegroundWindow();

            var teamsRunning = AnyProcessRunning(TeamsProcessNames);
            var zoomRunning = AnyProcessRunning(ZoomProcessNames);
            var browserRunning = AnyProcessRunning(BrowserProcessNames);

            var titleLower = title.ToLowerInvariant();

            // Microsoft Teams meeting window typically has "| Microsoft Teams" or
            // "Meeting in progress" in its title. The hub itself does not.
            if (TeamsProcessNames.Contains(procName, StringComparer.OrdinalIgnoreCase) ||
                (teamsRunning && titleLower.Contains("microsoft teams")))
            {
                if (titleLower.Contains("meeting") || titleLower.Contains("call") ||
                    titleLower.Contains("| microsoft teams"))
                {
                    return new MeetingDetectionResult
                    {
                        IsMeetingDetected = true,
                        Platform = "Teams",
                        WindowTitle = title,
                        ProcessName = procName,
                        Confidence = 0.85,
                        DetectionReason = "Teams process + meeting-like window title"
                    };
                }

                return new MeetingDetectionResult
                {
                    IsMeetingDetected = false,
                    Platform = "Teams",
                    WindowTitle = title,
                    ProcessName = procName,
                    Confidence = 0.4,
                    DetectionReason = "Teams running but no meeting-shaped window title"
                };
            }

            if (ZoomProcessNames.Contains(procName, StringComparer.OrdinalIgnoreCase) ||
                (zoomRunning && titleLower.Contains("zoom")))
            {
                if (titleLower.Contains("zoom meeting") || titleLower.Contains("zoom webinar") ||
                    titleLower.Equals("zoom", StringComparison.OrdinalIgnoreCase) == false &&
                    titleLower.Contains("zoom") && titleLower.Contains("-"))
                {
                    return new MeetingDetectionResult
                    {
                        IsMeetingDetected = true,
                        Platform = "Zoom",
                        WindowTitle = title,
                        ProcessName = procName,
                        Confidence = 0.85,
                        DetectionReason = "Zoom process + Zoom Meeting window title"
                    };
                }

                return new MeetingDetectionResult
                {
                    IsMeetingDetected = false,
                    Platform = "Zoom",
                    WindowTitle = title,
                    ProcessName = procName,
                    Confidence = 0.4,
                    DetectionReason = "Zoom running but no meeting-shaped window title"
                };
            }

            if (BrowserProcessNames.Contains(procName, StringComparer.OrdinalIgnoreCase) ||
                browserRunning)
            {
                if (titleLower.Contains("meet.google.com") ||
                    titleLower.Contains("google meet") ||
                    titleLower.Contains("meet -") ||
                    titleLower.Contains("- meet"))
                {
                    return new MeetingDetectionResult
                    {
                        IsMeetingDetected = true,
                        Platform = "GoogleMeet",
                        WindowTitle = title,
                        ProcessName = procName,
                        Confidence = 0.7,
                        DetectionReason = "Browser process + Google Meet window title"
                    };
                }
            }

            return MeetingDetectionResult.None();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Meeting detection failed.");
            return MeetingDetectionResult.None();
        }
    }

    private static bool AnyProcessRunning(IEnumerable<string> names)
    {
        foreach (var n in names)
        {
            try
            {
                if (Process.GetProcessesByName(n).Length > 0) return true;
            }
            catch
            {
                // Some processes can't be queried due to perms; ignore.
            }
        }
        return false;
    }
}
