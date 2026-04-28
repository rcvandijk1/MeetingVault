using MeetingVault.Core.Models;

namespace MeetingVault.Core.Services;

public class AudioCaptureOptions
{
    public string FolderPath { get; set; } = string.Empty;
    public bool CaptureMicrophone { get; set; } = true;
    public bool CaptureLoopback { get; set; } = true;
    public bool WriteCombined { get; set; } = true;
    public string? PreferredInputDeviceId { get; set; }
    public string? PreferredOutputDeviceId { get; set; }
}

public class AudioLevelEventArgs : EventArgs
{
    /// <summary>Peak amplitude in [0,1].</summary>
    public float MicLevel { get; init; }
    public float LoopbackLevel { get; init; }
}

public interface IAudioCaptureService : IDisposable
{
    AudioCaptureState State { get; }

    AudioSession? CurrentSession { get; }

    event EventHandler<AudioCaptureState>? StateChanged;

    event EventHandler<AudioLevelEventArgs>? LevelsChanged;

    event EventHandler<string>? CaptureFailed;

    Task<AudioSession> StartAsync(AudioCaptureOptions options, CancellationToken ct = default);

    Task<AudioSession> StopAsync(CancellationToken ct = default);
}
