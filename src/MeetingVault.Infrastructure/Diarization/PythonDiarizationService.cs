using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;

namespace MeetingVault.Infrastructure.Diarization;

/// <summary>
/// Real diarization via a Python sidecar that runs <c>pyannote.audio</c>.
///
/// Contract: we spawn the configured python executable with the bundled
/// <c>meetingvault_diarize.py</c> script, write a JSON request to stdin, and
/// read the response from stdout. The Python side handles model download,
/// diarization, embedding extraction, and matching against voiceprints we
/// load from <see cref="ISpeakerProfileStore"/>. Stderr is logged.
///
/// If anything fails (Python missing, license not accepted, model download
/// blocked) we propagate the exception; the router then falls back to the
/// stub so the user still gets something to review.
/// </summary>
public class PythonDiarizationService : ISpeakerDiarizationService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly ISettingsStore _settings;
    private readonly ISpeakerProfileStore _profiles;
    private readonly IPathService _paths;
    private readonly ILogger<PythonDiarizationService> _logger;

    public PythonDiarizationService(
        ISettingsStore settings,
        ISpeakerProfileStore profiles,
        IPathService paths,
        ILogger<PythonDiarizationService> logger)
    {
        _settings = settings;
        _profiles = profiles;
        _paths = paths;
        _logger = logger;
    }

    public string EngineName => "pyannote.audio (python sidecar)";

    public async Task<DiarizationResult> DiarizeAsync(DiarizationRequest request, CancellationToken ct = default)
    {
        var python = ResolvePython() ?? throw new InvalidOperationException(
            "Python executable not found. Set PythonExecutablePath in Settings.");
        var script = ResolveScriptPath() ?? throw new FileNotFoundException(
            "meetingvault_diarize.py not found next to the app or in %LOCALAPPDATA%\\MeetingVault\\python.");

        var voiceprints = await LoadVoiceprintsAsync(ct);

        var payload = new SidecarRequest
        {
            AudioPath = request.CombinedAudioPath,
            SpeakersFolder = request.SpeakersFolder,
            WhisperSegments = request.Segments.Select(s => new SidecarSegment
            {
                SegmentId = s.SegmentId,
                Start = s.Start.TotalSeconds,
                End = s.End.TotalSeconds,
                Text = s.Text
            }).ToList(),
            KnownVoiceprints = voiceprints,
            MatchThreshold = _settings.Current.SpeakerMatchThreshold,
            HfToken = _settings.Current.HuggingFaceToken
        };

        var requestJson = JsonSerializer.Serialize(payload, JsonOptions);

        var psi = new ProcessStartInfo
        {
            FileName = python,
            Arguments = $"\"{script}\"",
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardInputEncoding = Encoding.UTF8,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        // Make the HF token available via env var as well so the script can
        // pick it up even when it's not in the JSON body.
        if (!string.IsNullOrWhiteSpace(_settings.Current.HuggingFaceToken))
            psi.Environment["HF_TOKEN"] = _settings.Current.HuggingFaceToken!;

        _logger.LogInformation("Launching pyannote sidecar: {Python} {Script}", python, script);

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        if (!process.Start())
            throw new InvalidOperationException("Failed to start python sidecar.");

        var stderrTask = ReadAllAsync(process.StandardError, ct);
        var stdoutTask = ReadAllAsync(process.StandardOutput, ct);

        await process.StandardInput.WriteAsync(requestJson.AsMemory(), ct);
        process.StandardInput.Close();

        await process.WaitForExitAsync(ct);

        var stderr = await stderrTask;
        var stdout = await stdoutTask;

        if (!string.IsNullOrWhiteSpace(stderr))
            _logger.LogInformation("pyannote stderr: {Err}", stderr.Trim());

        if (process.ExitCode != 0 || string.IsNullOrWhiteSpace(stdout))
        {
            throw new InvalidOperationException(
                $"Python diarization failed (exit {process.ExitCode}). " +
                $"Stderr: {stderr.Trim()}");
        }

        SidecarResponse parsed;
        try
        {
            parsed = JsonSerializer.Deserialize<SidecarResponse>(stdout, JsonOptions)
                     ?? throw new InvalidOperationException("Empty diarization response.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException(
                $"Could not parse python response. First 500 bytes: {Truncate(stdout, 500)}", ex);
        }

        return MapResult(parsed, request);
    }

    private DiarizationResult MapResult(SidecarResponse parsed, DiarizationRequest request)
    {
        // Build the lookup of segment metadata so we can rebuild full segments
        // (Whisper text + diarized speaker label + original confidence).
        var originalById = request.Segments.ToDictionary(s => s.SegmentId);

        var annotated = new List<TranscriptionSegment>(parsed.Segments?.Count ?? 0);
        foreach (var seg in parsed.Segments ?? new List<SidecarSegmentOut>())
        {
            TranscriptionSegment? source = null;
            if (!string.IsNullOrEmpty(seg.SegmentId))
                originalById.TryGetValue(seg.SegmentId!, out source);

            annotated.Add(new TranscriptionSegment
            {
                SegmentId = seg.SegmentId ?? Guid.NewGuid().ToString("N"),
                Start = TimeSpan.FromSeconds(seg.Start),
                End = TimeSpan.FromSeconds(seg.End),
                Text = seg.Text ?? source?.Text ?? string.Empty,
                Confidence = source?.Confidence ?? 0,
                SourceAudio = source?.SourceAudio ?? TranscriptSourceAudio.Combined,
                SpeakerId = seg.SpeakerId,
                SpeakerName = null,
                NeedsSpeakerReview = true
            });
        }

        var speakers = new List<Speaker>();
        var unknownIndex = 1;
        foreach (var s in parsed.Speakers ?? new List<SidecarSpeaker>())
        {
            var isKnown = s.IsKnown && !string.IsNullOrWhiteSpace(s.DisplayName);
            speakers.Add(new Speaker
            {
                SpeakerId = s.SpeakerId,
                DisplayName = isKnown ? s.DisplayName! : $"Unknown Speaker {unknownIndex++}",
                IsKnown = isKnown,
                Confidence = s.Confidence,
                FirstSeenAt = TimeSpan.FromSeconds(s.FirstSeenSeconds).ToString(@"hh\:mm\:ss"),
                TotalSpeakingSeconds = Math.Round(s.TotalSpeakingSeconds, 1),
                SampleAudioPath = s.SampleAudioPath,
                Embedding = s.Embedding
            });
        }

        // Mark NeedsSpeakerReview = false on segments belonging to a recognised
        // speaker so the review screen can highlight only the unknowns.
        var knownIds = speakers.Where(x => x.IsKnown).Select(x => x.SpeakerId).ToHashSet();
        foreach (var seg in annotated)
        {
            if (seg.SpeakerId != null && knownIds.Contains(seg.SpeakerId))
            {
                seg.NeedsSpeakerReview = false;
                var sp = speakers.First(x => x.SpeakerId == seg.SpeakerId);
                seg.SpeakerName = sp.DisplayName;
            }
        }

        return new DiarizationResult
        {
            EngineName = $"{parsed.Engine ?? EngineName} {parsed.EngineVersion}".Trim(),
            Speakers = speakers,
            AnnotatedSegments = annotated,
            Notes = parsed.Notes ?? string.Empty
        };
    }

    private async Task<List<SidecarVoiceprint>> LoadVoiceprintsAsync(CancellationToken ct)
    {
        var profiles = await _profiles.ListAsync(ct);
        return profiles
            .Where(p => p.Embedding is { Length: > 0 })
            .Select(p => new SidecarVoiceprint
            {
                SpeakerId = p.SpeakerId,
                DisplayName = p.DisplayName,
                Embedding = p.Embedding!,
                EmbeddingModel = p.EmbeddingModel
            })
            .ToList();
    }

    private string? ResolvePython()
    {
        var configured = _settings.Current.PythonExecutablePath;
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        // Fall back to whatever is on PATH. We try python first, then python3
        // (rare on Windows but harmless).
        foreach (var name in new[] { "python.exe", "python", "python3.exe", "python3" })
        {
            var hit = TryFindOnPath(name);
            if (hit != null) return hit;
        }
        return null;
    }

    private string? ResolveScriptPath()
    {
        var configured = _settings.Current.PythonScriptPath;
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured))
            return configured;

        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "Resources", "python", "meetingvault_diarize.py"),
            Path.Combine(_paths.RootFolder, "python", "meetingvault_diarize.py"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                         "MeetingVault", "python", "meetingvault_diarize.py")
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static string? TryFindOnPath(string name)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return null;
        foreach (var dir in pathEnv.Split(Path.PathSeparator))
        {
            try
            {
                var candidate = Path.Combine(dir, name);
                if (File.Exists(candidate)) return candidate;
            }
            catch { /* malformed PATH entry, ignore */ }
        }
        return null;
    }

    private static async Task<string> ReadAllAsync(StreamReader reader, CancellationToken ct)
    {
        var sb = new StringBuilder();
        var buffer = new char[4096];
        int read;
        while ((read = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length), ct)) > 0)
            sb.Append(buffer, 0, read);
        return sb.ToString();
    }

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? string.Empty : (s.Length <= max ? s : s[..max] + "…");

    // ---- Sidecar JSON contract ---------------------------------------------

    private class SidecarRequest
    {
        public string AudioPath { get; set; } = string.Empty;
        public string SpeakersFolder { get; set; } = string.Empty;
        public List<SidecarSegment> WhisperSegments { get; set; } = new();
        public List<SidecarVoiceprint> KnownVoiceprints { get; set; } = new();
        public double MatchThreshold { get; set; }
        public string? HfToken { get; set; }
    }

    private class SidecarSegment
    {
        public string SegmentId { get; set; } = string.Empty;
        public double Start { get; set; }
        public double End { get; set; }
        public string Text { get; set; } = string.Empty;
    }

    private class SidecarVoiceprint
    {
        public string SpeakerId { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public float[] Embedding { get; set; } = Array.Empty<float>();
        public string? EmbeddingModel { get; set; }
    }

    private class SidecarResponse
    {
        public string? Engine { get; set; }
        public string? EngineVersion { get; set; }
        public string? EmbeddingModel { get; set; }
        public List<SidecarSpeaker>? Speakers { get; set; }
        public List<SidecarSegmentOut>? Segments { get; set; }
        public string? Notes { get; set; }
    }

    private class SidecarSpeaker
    {
        public string SpeakerId { get; set; } = string.Empty;
        public string? DisplayName { get; set; }
        public bool IsKnown { get; set; }
        public double Confidence { get; set; }
        public double FirstSeenSeconds { get; set; }
        public double TotalSpeakingSeconds { get; set; }
        public string? SampleAudioPath { get; set; }
        public float[]? Embedding { get; set; }
    }

    private class SidecarSegmentOut
    {
        public string? SegmentId { get; set; }
        public double Start { get; set; }
        public double End { get; set; }
        public string? Text { get; set; }
        public string? SpeakerId { get; set; }
    }
}
