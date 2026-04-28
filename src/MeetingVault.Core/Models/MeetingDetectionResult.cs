namespace MeetingVault.Core.Models;

public class MeetingDetectionResult
{
    public bool IsMeetingDetected { get; set; }

    public string Platform { get; set; } = "Unknown";

    public string WindowTitle { get; set; } = string.Empty;

    public string ProcessName { get; set; } = string.Empty;

    public DateTime DetectedAt { get; set; } = DateTime.Now;

    /// <summary>
    /// Heuristic confidence in the [0,1] range. We are intentionally conservative
    /// — a foreground process match alone tops out around 0.6, and we only push
    /// past 0.8 when both the process and the window title agree on the platform.
    /// </summary>
    public double Confidence { get; set; }

    public string DetectionReason { get; set; } = string.Empty;

    public static MeetingDetectionResult None() => new()
    {
        IsMeetingDetected = false,
        Platform = "None",
        DetectionReason = "No meeting detected"
    };
}
