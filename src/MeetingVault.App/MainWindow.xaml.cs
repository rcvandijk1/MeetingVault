using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using MeetingVault.App.ViewModels;
using MeetingVault.Core.Services;

namespace MeetingVault.App;

public partial class MainWindow : Window
{
    private readonly IRecordingCoordinator _coordinator;
    private readonly IPathService _paths;

    public MainWindow(MainViewModel vm, IRecordingCoordinator coordinator, IPathService paths)
    {
        InitializeComponent();
        DataContext = vm;
        _coordinator = coordinator;
        _paths = paths;

        _coordinator.StateChanged += (_, state) => Dispatcher.Invoke(() => UpdateTrayState(state));
        UpdateTrayState(_coordinator.State);
    }

    private void UpdateTrayState(RecordingCoordinatorState state)
    {
        // Tooltip reflects whether we are actively recording — the tray icon is the
        // user's only ambient signal when the window is hidden.
        var tip = state switch
        {
            RecordingCoordinatorState.Recording => "MeetingVault — recording in progress",
            RecordingCoordinatorState.Transcribing => "MeetingVault — transcribing",
            RecordingCoordinatorState.AwaitingSpeakerReview => "MeetingVault — speaker review pending",
            RecordingCoordinatorState.Failed => "MeetingVault — last recording failed",
            _ => "MeetingVault"
        };
        if (TrayIcon != null) TrayIcon.ToolTipText = tip;

        // Title reflects state too so the taskbar entry is informative when restored.
        Title = state == RecordingCoordinatorState.Recording
            ? "● MeetingVault — recording"
            : "MeetingVault";
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (App.IsExiting) { base.OnClosing(e); return; }
        e.Cancel = true;
        Hide();
    }

    private void TrayIcon_TrayMouseDoubleClick(object sender, RoutedEventArgs e) => RestoreWindow();

    private void OpenApp_Click(object sender, RoutedEventArgs e) => RestoreWindow();

    private void RestoreWindow()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    private async void TrayStart_Click(object sender, RoutedEventArgs e)
    {
        try { await _coordinator.StartAsync(null); }
        catch (Exception ex) { MessageBox.Show(ex.Message); }
    }

    private async void TrayStop_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var session = await _coordinator.StopAsync();
            _ = Task.Run(() => _coordinator.TranscribeAsync(session));
        }
        catch (Exception ex) { MessageBox.Show(ex.Message); }
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _paths.EnsureFoldersExist();
            Process.Start(new ProcessStartInfo { FileName = _paths.RootFolder, UseShellExecute = true });
        }
        catch { }
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => App.Shutdown();
}
