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

    // ---- Diarization (pyannote / Python sidecar) ----

    /// <summary>
    /// Which diarization engine to use. "Stub" = silence-gap heuristic (no
    /// model, no recognition). "Python" = the pyannote sidecar; falls back to
    /// the stub if Python or the script can't be reached.
    /// </summary>
    public string DiarizationEngine { get; set; } = "Stub";

    /// <summary>Absolute path to a python.exe with pyannote.audio installed.</summary>
    public string? PythonExecutablePath { get; set; }

    /// <summary>
    /// Path to the bundled <c>meetingvault_diarize.py</c>. When null we look for
    /// it next to the app exe (Resources/python/meetingvault_diarize.py) and
    /// then in <c>%LOCALAPPDATA%\MeetingVault\python</c>.
    /// </summary>
    public string? PythonScriptPath { get; set; }

    /// <summary>
    /// Hugging Face access token. Required to download
    /// <c>pyannote/speaker-diarization-3.1</c>. Stored in plain JSON; users
    /// who care about secret hygiene should keep settings.json on an encrypted
    /// drive.
    /// </summary>
    public string? HuggingFaceToken { get; set; }

    /// <summary>
    /// Cosine-similarity threshold for matching a new speaker embedding to an
    /// enrolled <c>SpeakerProfile</c>. 0.65–0.80 is a sensible range.
    /// </summary>
    public double SpeakerMatchThreshold { get; set; } = 0.7;

    /// <summary>
    /// When true, naming a speaker in the review screen and ticking
    /// "save profile" also persists the voice embedding for future
    /// auto-recognition.
    /// </summary>
    public bool EnrollVoicesOnSave { get; set; } = true;
}
