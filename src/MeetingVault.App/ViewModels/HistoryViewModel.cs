using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.App.ViewModels;

public partial class HistoryViewModel : ObservableObject
{
    private readonly IMeetingSessionStore _store;
    private readonly IRecordingCoordinator _coordinator;
    private readonly ILogger<HistoryViewModel> _logger;

    public ObservableCollection<MeetingSession> Meetings { get; } = new();

    [ObservableProperty] private MeetingSession? selected;
    [ObservableProperty] private string? subjectFilter;
    [ObservableProperty] private string? platformFilter;

    public Action<MeetingSession>? OnSpeakerReviewRequested { get; set; }

    public HistoryViewModel(IMeetingSessionStore store, IRecordingCoordinator coordinator, ILogger<HistoryViewModel> logger)
    {
        _store = store;
        _coordinator = coordinator;
        _logger = logger;
    }

    [RelayCommand]
    public async Task RefreshAsync()
    {
        try
        {
            var filter = new MeetingHistoryFilter
            {
                SubjectContains = string.IsNullOrWhiteSpace(SubjectFilter) ? null : SubjectFilter,
                Platform = string.IsNullOrWhiteSpace(PlatformFilter) ? null : PlatformFilter
            };
            var rows = await _store.ListAsync(filter);
            Meetings.Clear();
            foreach (var r in rows) Meetings.Add(r);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to load history.");
        }
    }

    [RelayCommand]
    private void OpenFolder(MeetingSession? s)
    {
        if (s == null || string.IsNullOrEmpty(s.FolderPath)) return;
        try { Process.Start(new ProcessStartInfo { FileName = s.FolderPath, UseShellExecute = true }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Open folder failed."); }
    }

    [RelayCommand]
    private void OpenTranscript(MeetingSession? s)
    {
        if (s == null || string.IsNullOrEmpty(s.TranscriptMarkdownPath) || !File.Exists(s.TranscriptMarkdownPath))
        {
            MessageBox.Show("Transcript not yet generated for this meeting.",
                "MeetingVault", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        try { Process.Start(new ProcessStartInfo { FileName = s.TranscriptMarkdownPath, UseShellExecute = true }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Open transcript failed."); }
    }

    [RelayCommand]
    private async Task RunTranscription(MeetingSession? s)
    {
        if (s == null) return;
        await Task.Run(() => _coordinator.TranscribeAsync(s));
        await RefreshAsync();
    }

    [RelayCommand]
    private void ReviewSpeakers(MeetingSession? s)
    {
        if (s == null) return;
        OnSpeakerReviewRequested?.Invoke(s);
    }

    [RelayCommand]
    private async Task SaveMetadata(MeetingSession? s)
    {
        if (s == null) return;
        await _store.UpdateAsync(s);
    }
}
