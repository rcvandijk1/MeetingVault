using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Extensions.Logging;
using NAudio.Wave;

namespace MeetingVault.Infrastructure.Diarization;

/// <summary>
/// Placeholder diarization. We do NOT pretend to identify speakers — this
/// implementation simply alternates between two labels using long pauses as a
/// boundary heuristic. It exists so the rest of the pipeline (review screen,
/// transcript writer, speakers.json) has real data to work with until a true
/// diarization engine is dropped in via <see cref="ISpeakerDiarizationService"/>.
/// </summary>
public class StubSpeakerDiarizationService : ISpeakerDiarizationService
{
    private const double PauseGapSeconds = 1.5;

    private readonly ILogger<StubSpeakerDiarizationService> _logger;

    public StubSpeakerDiarizationService(ILogger<StubSpeakerDiarizationService> logger)
    {
        _logger = logger;
    }

    public string EngineName => "StubDiarization";

    public Task<DiarizationResult> DiarizeAsync(DiarizationRequest request, CancellationToken ct = default)
    {
        var segments = request.Segments.OrderBy(s => s.Start).ToList();
        var annotated = new List<TranscriptionSegment>(segments.Count);

        // Heuristic: when a long-enough silence precedes a segment, flip the active speaker.
        // Confidence is intentionally low so the UI shows them as Unknown and prompts review.
        var current = "spk_001";
        TimeSpan? lastEnd = null;
        var speakingTimes = new Dictionary<string, double>();
        var firstSeen = new Dictionary<string, TimeSpan>();

        foreach (var seg in segments)
        {
            if (lastEnd.HasValue && (seg.Start - lastEnd.Value).TotalSeconds > PauseGapSeconds)
                current = current == "spk_001" ? "spk_002" : "spk_001";

            var copy = new TranscriptionSegment
            {
                SegmentId = seg.SegmentId,
                Start = seg.Start,
                End = seg.End,
                Text = seg.Text,
                Confidence = seg.Confidence,
                SourceAudio = seg.SourceAudio,
                SpeakerId = current,
                NeedsSpeakerReview = true
            };
            annotated.Add(copy);

            if (!firstSeen.ContainsKey(current)) firstSeen[current] = seg.Start;
            speakingTimes[current] = speakingTimes.GetValueOrDefault(current) + (seg.End - seg.Start).TotalSeconds;
            lastEnd = seg.End;
        }

        var speakers = new List<Speaker>();
        var index = 1;
        foreach (var id in speakingTimes.Keys.OrderBy(k => k))
        {
            var sample = TryWriteSample(request, id, request.SpeakersFolder);
            speakers.Add(new Speaker
            {
                SpeakerId = id,
                DisplayName = $"Unknown Speaker {index++}",
                IsKnown = false,
                Confidence = 0.4, // intentionally low — this is a stub
                FirstSeenAt = firstSeen[id].ToString(@"hh\:mm\:ss"),
                TotalSpeakingSeconds = Math.Round(speakingTimes[id], 1),
                SampleAudioPath = sample
            });
        }

        _logger.LogInformation("Stub diarization produced {Count} speakers from {Segments} segments.",
            speakers.Count, segments.Count);

        return Task.FromResult(new DiarizationResult
        {
            EngineName = EngineName,
            Speakers = speakers,
            AnnotatedSegments = annotated,
            Notes = "Placeholder diarization based on silence gaps. Replace with a real engine for biometric speaker ID."
        });
    }

    private static string? TryWriteSample(DiarizationRequest request, string speakerId, string speakersFolder)
    {
        if (string.IsNullOrEmpty(speakersFolder) ||
            string.IsNullOrEmpty(request.CombinedAudioPath) ||
            !File.Exists(request.CombinedAudioPath))
        {
            return null;
        }

        try
        {
            Directory.CreateDirectory(speakersFolder);
            // Sample first 8 seconds attributed to this speaker as a quick auditioning aid.
            var firstSeg = request.Segments.FirstOrDefault();
            if (firstSeg == null) return null;

            var samplePath = Path.Combine(speakersFolder, $"{speakerId}_sample.wav");
            using var reader = new AudioFileReader(request.CombinedAudioPath);
            reader.CurrentTime = firstSeg.Start;
            var format = reader.WaveFormat;
            var bytesPerSecond = format.AverageBytesPerSecond;
            var totalBytes = bytesPerSecond * 8;
            using var writer = new WaveFileWriter(samplePath, format);
            var buffer = new byte[bytesPerSecond / 10];
            int read;
            int written = 0;
            while (written < totalBytes && (read = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                writer.Write(buffer, 0, read);
                written += read;
            }
            return samplePath;
        }
        catch
        {
            return null;
        }
    }
}
