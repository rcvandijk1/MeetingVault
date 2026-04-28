using System.Diagnostics;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.App.ViewModels;

public partial class DashboardViewModel : ObservableObject
{
    private readonly IRecordingCoordinator _coordinator;
    private readonly IMeetingDetectionMonitor _detection;
    private readonly IAudioCaptureService _audio;
    private readonly IPathService _paths;
    private readonly IMeetingSessionStore _sessions;
    private readonly ILogger<DashboardViewModel> _logger;
    private readonly System.Timers.Timer _durationTimer;

    [ObservableProperty] private string detectionStatus = "Idle — no meeting detected";
    [ObservableProperty] private string detectedPlatform = "—";
    [ObservableProperty] private string detectionReason = "";
    [ObservableProperty] private bool isMeetingDetected;
    [ObservableProperty] private bool isRecording;
    [ObservableProperty] private string duration = "00:00:00";
    [ObservableProperty] private string statusMessage = "Ready.";
    [ObservableProperty] private double micLevel;
    [ObservableProperty] private double loopbackLevel;
    [ObservableProperty] private string lastMeetingSummary = "No previous meeting.";
    [ObservableProperty] private MeetingSession? currentSession;

    public Action<MeetingSession>? OnSpeakerReviewRequested { get; set; }

    public DashboardViewModel(
        IRecordingCoordinator coordinator,
        IMeetingDetectionMonitor detection,
        IAudioCaptureService audio,
        IPathService paths,
        IMeetingSessionStore sessions,
        ILogger<DashboardViewModel> logger)
    {
        _coordinator = coordinator;
        _detection = detection;
        _audio = audio;
        _paths = paths;
        _sessions = sessions;
        _logger = logger;

        _detection.DetectionChanged += OnDetectionChanged;
        _coordinator.StateChanged += OnCoordinatorStateChanged;
        _coordinator.StatusMessage += OnCoordinatorStatusMessage;
        _audio.LevelsChanged += OnLevels;

        _durationTimer = new System.Timers.Timer(500) { AutoReset = true };
        _durationTimer.Elapsed += (_, _) => UpdateDuration();

        _ = RefreshLastMeetingAsync();
    }

    public async Task RefreshLastMeetingAsync()
    {
        try
        {
            var list = await _sessions.ListAsync();
            var first = list.FirstOrDefault();
            LastMeetingSummary = first == null
                ? "No previous meeting."
                : $"{first.StartTime:yyyy-MM-dd HH:mm} — {first.Subject} ({first.Platform}) [{first.Status}]";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load last meeting.");
        }
    }

    [RelayCommand]
    private async Task StartRecording()
    {
        try
        {
            var detection = _detection.Latest;
            CurrentSession = await _coordinator.StartAsync(detection);
            IsRecording = true;
            _durationTimer.Start();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Start recording failed.");
            MessageBox.Show($"Failed to start recording:\n\n{ex.Message}",
                "MeetingVault", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    [RelayCommand]
    private async Task StopRecording()
    {
        try
        {
            _durationTimer.Stop();
            var session = await _coordinator.StopAsync();
            IsRecording = false;

            // Kick off transcription on a background task so the UI stays responsive.
            _ = Task.Run(async () =>
            {
                var done = await _coordinator.TranscribeAsync(session);
                if (done.Status == MeetingSessionStatus.AwaitingSpeakerReview)
                {
                    Application.Current.Dispatcher.Invoke(() => OnSpeakerReviewRequested?.Invoke(done));
                }
                await Application.Current.Dispatcher.InvokeAsync(RefreshLastMeetingAsync);
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stop recording failed.");
            MessageBox.Show($"Failed to stop recording:\n\n{ex.Message}",
                "MeetingVault", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    [RelayCommand]
    private void OpenMeetingsFolder()
    {
        try
        {
            _paths.EnsureFoldersExist();
            Process.Start(new ProcessStartInfo { FileName = _paths.MeetingsFolder, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not open folder.");
        }
    }

    private void OnDetectionChanged(object? sender, MeetingDetectionResult e)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            IsMeetingDetected = e.IsMeetingDetected;
            DetectedPlatform = e.IsMeetingDetected ? e.Platform : "—";
            DetectionReason = e.DetectionReason;
            DetectionStatus = e.IsMeetingDetected
                ? $"Meeting detected on {e.Platform} (confidence {(int)(e.Confidence * 100)}%)."
                : "Idle — no meeting detected";
        });
    }

    private void OnCoordinatorStateChanged(object? sender, RecordingCoordinatorState state)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            IsRecording = state == RecordingCoordinatorState.Recording;
            if (!IsRecording) _durationTimer.Stop();
        });
    }

    private void OnCoordinatorStatusMessage(object? sender, string message)
    {
        Application.Current.Dispatcher.Invoke(() => StatusMessage = message);
    }

    private void OnLevels(object? sender, AudioLevelEventArgs e)
    {
        Application.Current.Dispatcher.Invoke(() =>
        {
            MicLevel = e.MicLevel;
            LoopbackLevel = e.LoopbackLevel;
        });
    }

    private void UpdateDuration()
    {
        var s = _coordinator.Current;
        if (s == null) return;
        var d = (DateTime.Now - s.StartTime);
        Application.Current.Dispatcher.Invoke(() => Duration = d.ToString(@"hh\:mm\:ss"));
    }
}
