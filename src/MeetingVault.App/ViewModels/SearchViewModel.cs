using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.App.ViewModels;

public partial class SearchViewModel : ObservableObject
{
    private readonly IMeetingSessionStore _sessions;
    private readonly ILogger<SearchViewModel> _logger;

    public ObservableCollection<TranscriptSearchHit> Results { get; } = new();

    [ObservableProperty] private string? query;
    [ObservableProperty] private string statusText = "Type a phrase and press Search.";

    public SearchViewModel(IMeetingSessionStore sessions, ILogger<SearchViewModel> logger)
    {
        _sessions = sessions;
        _logger = logger;
    }

    [RelayCommand]
    private async Task RunSearch()
    {
        Results.Clear();
        if (string.IsNullOrWhiteSpace(Query))
        {
            StatusText = "Type a phrase and press Search.";
            return;
        }

        try
        {
            var hits = await _sessions.SearchTranscriptsAsync(Query);
            foreach (var h in hits) Results.Add(h);
            StatusText = hits.Count == 0
                ? $"No matches for '{Query}'."
                : $"Found {hits.Count} meeting{(hits.Count == 1 ? "" : "s")} containing '{Query}'.";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Search failed.");
            StatusText = $"Search failed: {ex.Message}";
        }
    }

    [RelayCommand]
    private async Task OpenMeeting(TranscriptSearchHit? hit)
    {
        if (hit == null) return;
        var session = await _sessions.GetAsync(hit.SessionId);
        if (session == null || string.IsNullOrEmpty(session.FolderPath)) return;
        try { Process.Start(new ProcessStartInfo { FileName = session.FolderPath, UseShellExecute = true }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Open folder failed."); }
    }
}
