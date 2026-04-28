using System.Collections.ObjectModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.App.ViewModels;

public partial class SpeakerReviewViewModel : ObservableObject
{
    private readonly ISpeakerStore _speakerStore;
    private readonly ITranscriptWriter _transcriptWriter;
    private readonly ISpeakerProfileStore _profileStore;
    private readonly IMeetingSessionStore _sessions;
    private readonly ISettingsStore _settings;
    private readonly ILogger<SpeakerReviewViewModel> _logger;

    public ObservableCollection<SpeakerEditModel> Speakers { get; } = new();

    [ObservableProperty] private MeetingSession? session;
    [ObservableProperty] private string headerText = "No meeting loaded.";

    public SpeakerReviewViewModel(
        ISpeakerStore speakerStore,
        ITranscriptWriter transcriptWriter,
        ISpeakerProfileStore profileStore,
        IMeetingSessionStore sessions,
        ISettingsStore settings,
        ILogger<SpeakerReviewViewModel> logger)
    {
        _speakerStore = speakerStore;
        _transcriptWriter = transcriptWriter;
        _profileStore = profileStore;
        _sessions = sessions;
        _settings = settings;
        _logger = logger;
    }

    public async Task LoadAsync(MeetingSession session)
    {
        Session = session;
        HeaderText = $"Speakers in {session.Subject} ({session.StartTime:yyyy-MM-dd HH:mm})";

        Speakers.Clear();
        if (string.IsNullOrEmpty(session.SpeakersJsonPath) || !File.Exists(session.SpeakersJsonPath))
        {
            HeaderText += " — speakers.json not found. Run transcription first.";
            return;
        }

        var speakers = await _speakerStore.ReadAsync(session.SpeakersJsonPath);
        foreach (var s in speakers.Where(x => string.IsNullOrEmpty(x.MergedIntoSpeakerId)))
        {
            Speakers.Add(new SpeakerEditModel(s));
        }
    }

    [RelayCommand]
    private async Task SaveAll()
    {
        if (Session == null) return;

        // Build authoritative speaker list, applying merges into the surviving id.
        var alive = Speakers.Where(s => !s.Ignored && string.IsNullOrEmpty(s.MergedIntoSpeakerId))
                            .Select(s => s.ToModel())
                            .ToList();
        var ignored = Speakers.Where(s => s.Ignored)
                              .Select(s => s.ToModel(forceIgnored: true))
                              .ToList();
        var merged = Speakers.Where(s => !string.IsNullOrEmpty(s.MergedIntoSpeakerId))
                             .Select(s => s.ToModel())
                             .ToList();

        var allForFile = alive.Concat(ignored).Concat(merged).ToList();

        if (!string.IsNullOrEmpty(Session.SpeakersJsonPath))
            await _speakerStore.WriteAsync(Session.SpeakersJsonPath, allForFile);

        // Update transcript: re-attribute SpeakerId and SpeakerName, then re-render markdown.
        if (!string.IsNullOrEmpty(Session.TranscriptJsonPath) && File.Exists(Session.TranscriptJsonPath))
        {
            var segs = (await _transcriptWriter.ReadJsonAsync(Session.TranscriptJsonPath)).ToList();
            var mergeMap = Speakers
                .Where(s => !string.IsNullOrEmpty(s.MergedIntoSpeakerId))
                .ToDictionary(s => s.SpeakerId, s => s.MergedIntoSpeakerId!);

            var nameMap = allForFile.ToDictionary(s => s.SpeakerId, s => s.DisplayName);
            for (int i = 0; i < segs.Count; i++)
            {
                var seg = segs[i];
                if (seg.SpeakerId != null && mergeMap.TryGetValue(seg.SpeakerId, out var into))
                    seg.SpeakerId = into;
                if (seg.SpeakerId != null && nameMap.TryGetValue(seg.SpeakerId, out var name))
                {
                    seg.SpeakerName = name;
                    seg.NeedsSpeakerReview = !alive.First(a => a.SpeakerId == seg.SpeakerId).IsKnown;
                }
            }
            await _transcriptWriter.WriteJsonAsync(Session.TranscriptJsonPath, segs);

            if (!string.IsNullOrEmpty(Session.TranscriptMarkdownPath))
                await _transcriptWriter.WriteMarkdownAsync(Session.TranscriptMarkdownPath, Session, segs, alive);
        }

        // Persist any "save profile" speakers to SpeakerProfiles.
        foreach (var s in Speakers.Where(s => s.SaveProfile && !string.IsNullOrWhiteSpace(s.NewName)))
        {
            await _profileStore.SaveAsync(new SpeakerProfile
            {
                SpeakerId = $"spk_{Sanitize(s.NewName!)}",
                DisplayName = s.NewName!.Trim(),
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                VoiceProfileAvailable = false
            });
        }

        Session.Status = MeetingSessionStatus.Completed;
        await _sessions.UpdateAsync(Session);
    }

    [RelayCommand]
    private void PlaySample(SpeakerEditModel? s)
    {
        if (s == null || string.IsNullOrEmpty(s.SampleAudioPath) || !File.Exists(s.SampleAudioPath)) return;
        try { Process.Start(new ProcessStartInfo { FileName = s.SampleAudioPath, UseShellExecute = true }); }
        catch (Exception ex) { _logger.LogWarning(ex, "Play sample failed."); }
    }

    [RelayCommand]
    private void MarkAsMe(SpeakerEditModel? s)
    {
        if (s == null) return;
        s.IsMe = true;
        s.NewName = _settings.Current.MyDisplayName;
    }

    [RelayCommand]
    private void Ignore(SpeakerEditModel? s)
    {
        if (s == null) return;
        s.Ignored = true;
    }

    [RelayCommand]
    private void Merge(SpeakerEditModel? s)
    {
        if (s == null || Speakers.Count < 2) return;
        // Simplest merge UX: merge into the first other surviving speaker.
        var target = Speakers.FirstOrDefault(x => x != s && !x.Ignored && string.IsNullOrEmpty(x.MergedIntoSpeakerId));
        if (target == null) return;
        s.MergedIntoSpeakerId = target.SpeakerId;
    }

    private static string Sanitize(string s)
        => new(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
}

public partial class SpeakerEditModel : ObservableObject
{
    public string SpeakerId { get; }
    public string OriginalDisplayName { get; }
    public double TotalSpeakingSeconds { get; }
    public string? FirstSeenAt { get; }
    public string? SampleAudioPath { get; }

    [ObservableProperty] private string? newName;
    [ObservableProperty] private bool ignored;
    [ObservableProperty] private bool isMe;
    [ObservableProperty] private bool saveProfile;
    [ObservableProperty] private string? mergedIntoSpeakerId;

    public SpeakerEditModel(Speaker s)
    {
        SpeakerId = s.SpeakerId;
        OriginalDisplayName = s.DisplayName;
        NewName = s.IsKnown ? s.DisplayName : null;
        TotalSpeakingSeconds = s.TotalSpeakingSeconds;
        FirstSeenAt = s.FirstSeenAt;
        SampleAudioPath = s.SampleAudioPath;
    }

    public Speaker ToModel(bool forceIgnored = false) => new()
    {
        SpeakerId = SpeakerId,
        DisplayName = string.IsNullOrWhiteSpace(NewName) ? OriginalDisplayName : NewName!.Trim(),
        IsKnown = !forceIgnored && !string.IsNullOrWhiteSpace(NewName),
        IsMe = IsMe,
        Ignored = forceIgnored || Ignored,
        TotalSpeakingSeconds = TotalSpeakingSeconds,
        FirstSeenAt = FirstSeenAt,
        SampleAudioPath = SampleAudioPath,
        MergedIntoSpeakerId = MergedIntoSpeakerId
    };
}
