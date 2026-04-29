using System.Windows;
using MeetingVault.App.ViewModels;
using MeetingVault.Core.Services;
using MeetingVault.Infrastructure;
using MeetingVault.Infrastructure.Audio;
using MeetingVault.Infrastructure.Calendar;
using MeetingVault.Infrastructure.Detection;
using MeetingVault.Infrastructure.Diarization;
using MeetingVault.Infrastructure.Logging;
using MeetingVault.Infrastructure.Persistence;
using MeetingVault.Infrastructure.Transcription;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace MeetingVault.App;

public partial class App : Application
{
    private IServiceProvider? _services;
    public static bool IsExiting { get; private set; }

    public new static App Current => (App)Application.Current;

    public IServiceProvider Services => _services ?? throw new InvalidOperationException("Services not built.");

    public static void Shutdown()
    {
        IsExiting = true;
        Application.Current.Shutdown();
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _services = BuildServices();

        var logger = _services.GetRequiredService<ILoggerFactory>().CreateLogger("App");
        logger.LogInformation("MeetingVault starting up.");

        // Bootstrap settings + folders before any service touches the disk.
        var settings = _services.GetRequiredService<ISettingsStore>();
        settings.Load();
        _services.GetRequiredService<IPathService>().EnsureFoldersExist();

        // First-run privacy acknowledgement.
        if (!settings.Current.FirstRunAcknowledged)
        {
            var result = MessageBox.Show(
                "This application records and transcribes meetings locally. " +
                "Only use it where you are allowed to record.\n\n" +
                "Click OK to continue, Cancel to exit.",
                "MeetingVault — Privacy notice",
                MessageBoxButton.OKCancel, MessageBoxImage.Information);
            if (result != MessageBoxResult.OK)
            {
                Shutdown();
                return;
            }
            settings.Update(s => s.FirstRunAcknowledged = true);
        }

        // Start meeting detection if enabled.
        if (settings.Current.AutoDetectMeetings)
        {
            _services.GetRequiredService<IMeetingDetectionMonitor>().Start();
        }

        var window = _services.GetRequiredService<MainWindow>();
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            _services?.GetService<IMeetingDetectionMonitor>()?.Dispose();
            (_services?.GetService<IAudioCaptureService>() as IDisposable)?.Dispose();
        }
        catch { }
        base.OnExit(e);
    }

    private static IServiceProvider BuildServices()
    {
        var services = new ServiceCollection();

        // Logging — file logger goes to %USERPROFILE%\Documents\MeetingVault\Logs.
        var logFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "MeetingVault", "Logs");
        services.AddLogging(b =>
        {
            b.SetMinimumLevel(LogLevel.Information);
            b.AddDebug();
            b.AddProvider(new FileLoggerProvider(logFolder));
        });

        // Core services
        services.AddSingleton<ISettingsStore, JsonSettingsStore>();
        services.AddSingleton<IPathService, PathService>();
        services.AddSingleton<IActiveWindowService, ActiveWindowService>();
        services.AddSingleton<IMeetingDetector, ProcessMeetingDetector>();
        services.AddSingleton<IMeetingDetectionMonitor, MeetingDetectionMonitor>();
        services.AddSingleton<IAudioCaptureService, WasapiAudioCaptureService>();
        services.AddSingleton<IMetadataWriter, JsonMetadataWriter>();
        services.AddSingleton<ITranscriptionService, WhisperTranscriptionService>();
        services.AddSingleton<ITranscriptWriter, JsonTranscriptWriter>();
        services.AddSingleton<ISpeakerDiarizationService, StubSpeakerDiarizationService>();
        services.AddSingleton<ISpeakerStore, JsonSpeakerStore>();
        services.AddSingleton<ISpeakerProfileStore, JsonSpeakerProfileStore>();
        services.AddSingleton<IMeetingSessionStore, SqliteMeetingSessionStore>();
        services.AddSingleton<ICalendarCorrelationService, NullCalendarCorrelationService>();
        services.AddSingleton<IRecordingCoordinator, RecordingCoordinator>();

        // ViewModels
        services.AddSingleton<DashboardViewModel>();
        services.AddSingleton<HistoryViewModel>();
        services.AddSingleton<SpeakerReviewViewModel>();
        services.AddSingleton<SettingsViewModel>();
        services.AddSingleton<SearchViewModel>();
        services.AddSingleton<MainViewModel>();

        services.AddSingleton<MainWindow>();
        return services.BuildServiceProvider();
    }
}
