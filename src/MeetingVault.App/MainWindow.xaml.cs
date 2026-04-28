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
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        // Minimize to tray instead of exiting; explicit Exit menu actually quits.
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
