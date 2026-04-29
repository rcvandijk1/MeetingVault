using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace MeetingVault.App.ViewModels;

public partial class MainViewModel : ObservableObject
{
    [ObservableProperty]
    private object? currentView;

    [ObservableProperty]
    private string activeTab = "Dashboard";

    public DashboardViewModel Dashboard { get; }
    public HistoryViewModel History { get; }
    public SpeakerReviewViewModel SpeakerReview { get; }
    public SettingsViewModel Settings { get; }
    public SearchViewModel Search { get; }

    public MainViewModel(DashboardViewModel dashboard, HistoryViewModel history,
        SpeakerReviewViewModel speakerReview, SettingsViewModel settings, SearchViewModel search)
    {
        Dashboard = dashboard;
        History = history;
        SpeakerReview = speakerReview;
        Settings = settings;
        Search = search;
        CurrentView = Dashboard;

        Dashboard.OnSpeakerReviewRequested = session =>
        {
            SpeakerReview.LoadAsync(session).ContinueWith(_ => { });
            ShowSpeakerReview();
        };
        History.OnSpeakerReviewRequested = session =>
        {
            SpeakerReview.LoadAsync(session).ContinueWith(_ => { });
            ShowSpeakerReview();
        };
    }

    [RelayCommand] private void ShowDashboard() { CurrentView = Dashboard; ActiveTab = "Dashboard"; }
    [RelayCommand] private async Task ShowHistory()
    {
        await History.RefreshAsync();
        CurrentView = History;
        ActiveTab = "History";
    }
    [RelayCommand] private void ShowSpeakerReview() { CurrentView = SpeakerReview; ActiveTab = "Speakers"; }
    [RelayCommand] private void ShowSearch() { CurrentView = Search; ActiveTab = "Search"; }
    [RelayCommand] private void ShowSettings() { CurrentView = Settings; ActiveTab = "Settings"; }
}
