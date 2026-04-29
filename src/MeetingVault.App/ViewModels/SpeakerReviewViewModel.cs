using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
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

        // Populate per-row merge target lists with everyone but self.
        foreach (var row in Speakers)
        {
            row.MergeCandidates.Clear();
            foreach (var other in Speakers.Where(x => x.SpeakerId != row.SpeakerId))
                row.MergeCandidates.Add(other);
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

            // Mirror the renamed segments + speakers into the SQLite index so the search
            // results reflect the new names instead of "Unknown Speaker N".
            try
            {
                await _sessions.ReplaceSegmentsAsync(Session.SessionId, segs);
                await _sessions.ReplaceSpeakersAsync(Session.SessionId, alive);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SQLite re-index after speaker review failed.");
            }
        }

        // Persist named speakers as reusable profiles (with voice embeddings
        // when the engine produced one) so future meetings auto-recognize them.
        // We enroll a voice when EITHER the user explicitly ticked SaveProfile
        // OR EnrollVoicesOnSave is true and the speaker now has a real name.
        var enrollByDefault = _settings.Current.EnrollVoicesOnSave;
        var enrollees = Speakers.Where(s =>
            !string.IsNullOrWhiteSpace(s.NewName) &&
            !s.Ignored &&
            string.IsNullOrEmpty(s.MergedIntoSpeakerId) &&
            (s.SaveProfile || enrollByDefault));

        foreach (var s in enrollees)
        {
            var profileId = $"spk_{Sanitize(s.NewName!)}";
            // Merge with an existing profile if the user has named this person
            // before — preserves the existing embedding and notes.
            var existing = await _profileStore.GetAsync(profileId);
            var profile = existing ?? new SpeakerProfile
            {
                SpeakerId = profileId,
                CreatedAt = DateTime.UtcNow
            };
            profile.DisplayName = s.NewName!.Trim();
            profile.UpdatedAt = DateTime.UtcNow;
            if (s.Embedding is { Length: > 0 })
            {
                profile.Embedding = s.Embedding;
                profile.EmbeddingModel = "pyannote/embedding";
                profile.VoiceProfileAvailable = true;
            }
            await _profileStore.SaveAsync(profile);
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
        // Use the picked target if the user chose one; otherwise fall back to the first survivor.
        var target = !string.IsNullOrEmpty(s.SelectedMergeTargetId)
            ? Speakers.FirstOrDefault(x => x.SpeakerId == s.SelectedMergeTargetId && x != s)
            : Speakers.FirstOrDefault(x => x != s && !x.Ignored && string.IsNullOrEmpty(x.MergedIntoSpeakerId));
        if (target == null) return;
        s.MergedIntoSpeakerId = target.SpeakerId;
    }

    private static string Sanitize(string s)
        => new string(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
}

public partial class SpeakerEditModel : ObservableObject
{
    public string SpeakerId { get; }
    public string OriginalDisplayName { get; }
    public double TotalSpeakingSeconds { get; }
    public string? FirstSeenAt { get; }
    public string? SampleAudioPath { get; }
    public float[]? Embedding { get; }
    public bool WasAutoRecognized { get; }
    public double RecognitionConfidence { get; }
    public string RecognitionBadge =>
        WasAutoRecognized
            ? $"Auto-recognized ({(int)(RecognitionConfidence * 100)}% match)"
            : "New speaker — please name";
    public ObservableCollection<SpeakerEditModel> MergeCandidates { get; } = new();

    [ObservableProperty] private string? newName;
    [ObservableProperty] private bool ignored;
    [ObservableProperty] private bool isMe;
    [ObservableProperty] private bool saveProfile;
    [ObservableProperty] private string? mergedIntoSpeakerId;
    [ObservableProperty] private string? selectedMergeTargetId;

    public SpeakerEditModel(Speaker s)
    {
        SpeakerId = s.SpeakerId;
        OriginalDisplayName = s.DisplayName;
        NewName = s.IsKnown ? s.DisplayName : null;
        TotalSpeakingSeconds = s.TotalSpeakingSeconds;
        FirstSeenAt = s.FirstSeenAt;
        SampleAudioPath = s.SampleAudioPath;
        Embedding = s.Embedding;
        WasAutoRecognized = s.IsKnown;
        RecognitionConfidence = s.Confidence;
        // If the diarization engine matched a known voice we default the
        // SaveProfile flag off — there is already a profile.
        SaveProfile = false;
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
        Embedding = Embedding,
        MergedIntoSpeakerId = MergedIntoSpeakerId
    };
}
