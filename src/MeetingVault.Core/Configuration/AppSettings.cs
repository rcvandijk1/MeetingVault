namespace MeetingVault.Core.Configuration;

public class AppSettings
{
    public string? RootFolderOverride { get; set; }

    public string? WhisperModelPath { get; set; }

    public string WhisperLanguage { get; set; } = "auto";

    public string? DefaultInputDeviceId { get; set; }

    public string? DefaultOutputDeviceId { get; set; }

    public bool AutoDetectMeetings { get; set; } = true;

    public bool AutoStartRecording { get; set; } = false;

    public bool SaveSeparateAudioStreams { get; set; } = true;

    public bool SaveCombinedAudio { get; set; } = true;

    public bool KeepRawAudio { get; set; } = true;

    public string MyDisplayName { get; set; } = "Me";

    public bool FirstRunAcknowledged { get; set; }

    /// <summary>
    /// Polling interval (ms) for meeting detection. Kept conservative so we do
    /// not hammer EnumProcesses; raise for low-power scenarios.
    /// </summary>
    public int DetectionPollMs { get; set; } = 3000;
}
