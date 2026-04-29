using Dapper;
using MeetingVault.Core.Models;
using MeetingVault.Core.Services;
using Microsoft.Data.Sqlite;

namespace MeetingVault.Infrastructure.Persistence;

/// <summary>
/// SQLite-backed meeting index. The on-disk JSON files (metadata.json,
/// transcript.json, speakers.json) remain the source of truth — this DB is
/// just a fast index for history listings and search.
/// </summary>
public class SqliteMeetingSessionStore : IMeetingSessionStore
{
    private readonly IPathService _paths;
    private readonly Lazy<string> _connectionString;

    public SqliteMeetingSessionStore(IPathService paths)
    {
        _paths = paths;
        _connectionString = new Lazy<string>(() =>
        {
            _paths.EnsureFoldersExist();
            var cs = $"Data Source={_paths.DatabasePath}";
            SqliteSchema.EnsureCreated(cs);
            return cs;
        });
    }

    public async Task<MeetingSession> CreateAsync(MeetingSession session, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        await conn.ExecuteAsync(@"
            INSERT INTO Meetings (SessionId, Platform, Subject, StartTime, EndTime, DurationSeconds,
                WindowTitle, ProcessName, FolderPath, AudioMePath, AudioOthersPath, AudioCombinedPath,
                MetadataPath, TranscriptMarkdownPath, TranscriptJsonPath, SpeakersJsonPath,
                Organizer, MeetingUrl, Notes, Status)
            VALUES (@SessionId, @Platform, @Subject, @StartTime, @EndTime, @DurationSeconds,
                @WindowTitle, @ProcessName, @FolderPath, @AudioMePath, @AudioOthersPath, @AudioCombinedPath,
                @MetadataPath, @TranscriptMarkdownPath, @TranscriptJsonPath, @SpeakersJsonPath,
                @Organizer, @MeetingUrl, @Notes, @Status);",
            ToRow(session));
        return session;
    }

    public async Task UpdateAsync(MeetingSession session, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        await conn.ExecuteAsync(@"
            UPDATE Meetings SET
                Platform=@Platform, Subject=@Subject, StartTime=@StartTime, EndTime=@EndTime,
                DurationSeconds=@DurationSeconds, WindowTitle=@WindowTitle, ProcessName=@ProcessName,
                FolderPath=@FolderPath, AudioMePath=@AudioMePath, AudioOthersPath=@AudioOthersPath,
                AudioCombinedPath=@AudioCombinedPath, MetadataPath=@MetadataPath,
                TranscriptMarkdownPath=@TranscriptMarkdownPath, TranscriptJsonPath=@TranscriptJsonPath,
                SpeakersJsonPath=@SpeakersJsonPath, Organizer=@Organizer, MeetingUrl=@MeetingUrl,
                Notes=@Notes, Status=@Status
            WHERE SessionId=@SessionId;",
            ToRow(session));
    }

    public async Task<MeetingSession?> GetAsync(string sessionId, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        var row = await conn.QuerySingleOrDefaultAsync<MeetingRow>(
            "SELECT * FROM Meetings WHERE SessionId=@id", new { id = sessionId });
        return row == null ? null : FromRow(row);
    }

    public async Task<IReadOnlyList<MeetingSession>> ListAsync(MeetingHistoryFilter? filter = null, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);

        var sql = "SELECT * FROM Meetings WHERE 1=1";
        var args = new DynamicParameters();
        if (filter?.From != null) { sql += " AND StartTime >= @from"; args.Add("from", filter.From.Value.ToString("o")); }
        if (filter?.To != null) { sql += " AND StartTime <= @to"; args.Add("to", filter.To.Value.ToString("o")); }
        if (!string.IsNullOrWhiteSpace(filter?.Platform)) { sql += " AND Platform = @platform"; args.Add("platform", filter.Platform); }
        if (!string.IsNullOrWhiteSpace(filter?.SubjectContains)) { sql += " AND Subject LIKE @subj"; args.Add("subj", $"%{filter.SubjectContains}%"); }
        sql += " ORDER BY StartTime DESC";

        var rows = await conn.QueryAsync<MeetingRow>(sql, args);
        return rows.Select(FromRow).ToList();
    }

    public async Task DeleteAsync(string sessionId, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        await conn.ExecuteAsync("DELETE FROM Meetings WHERE SessionId=@id", new { id = sessionId });
    }

    public async Task ReplaceSegmentsAsync(string sessionId, IReadOnlyList<TranscriptionSegment> segments, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        await using var tx = (SqliteTransaction)await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync("DELETE FROM TranscriptSegments WHERE SessionId=@id",
            new { id = sessionId }, tx);
        foreach (var seg in segments)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO TranscriptSegments
                    (SegmentId, SessionId, StartSeconds, EndSeconds, SpeakerId, SpeakerName, Text, Confidence, SourceAudio)
                VALUES (@SegmentId, @SessionId, @Start, @End, @SpeakerId, @SpeakerName, @Text, @Confidence, @SourceAudio);",
                new
                {
                    seg.SegmentId,
                    SessionId = sessionId,
                    Start = seg.Start.TotalSeconds,
                    End = seg.End.TotalSeconds,
                    seg.SpeakerId,
                    seg.SpeakerName,
                    seg.Text,
                    seg.Confidence,
                    SourceAudio = seg.SourceAudio.ToString()
                }, tx);
        }
        await tx.CommitAsync(ct);
    }

    public async Task ReplaceSpeakersAsync(string sessionId, IReadOnlyList<Speaker> speakers, CancellationToken ct = default)
    {
        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);
        await using var tx = (SqliteTransaction)await conn.BeginTransactionAsync(ct);
        await conn.ExecuteAsync("DELETE FROM Speakers WHERE SessionId=@id",
            new { id = sessionId }, tx);
        foreach (var s in speakers)
        {
            await conn.ExecuteAsync(@"
                INSERT INTO Speakers
                    (SessionId, SpeakerId, DisplayName, IsKnown, Confidence, TotalSpeakingSeconds, SampleAudioPath)
                VALUES (@SessionId, @SpeakerId, @DisplayName, @IsKnown, @Confidence, @TotalSpeakingSeconds, @SampleAudioPath);",
                new
                {
                    SessionId = sessionId,
                    s.SpeakerId,
                    s.DisplayName,
                    IsKnown = s.IsKnown ? 1 : 0,
                    s.Confidence,
                    s.TotalSpeakingSeconds,
                    s.SampleAudioPath
                }, tx);
        }
        await tx.CommitAsync(ct);
    }

    public async Task<IReadOnlyList<TranscriptSearchHit>> SearchTranscriptsAsync(string query, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query)) return Array.Empty<TranscriptSearchHit>();

        await using var conn = new SqliteConnection(_connectionString.Value);
        await conn.OpenAsync(ct);

        // Simple LIKE search; SQLite FTS would be a Phase-6 upgrade.
        var rows = await conn.QueryAsync<SearchRow>(@"
            SELECT m.SessionId, m.Subject, m.Platform, m.StartTime,
                   ts.Text AS Snippet, ts.StartSeconds AS SegmentStart, ts.SpeakerName,
                   (SELECT COUNT(*) FROM TranscriptSegments ts2
                      WHERE ts2.SessionId = m.SessionId AND ts2.Text LIKE @q) AS MatchCount
            FROM Meetings m
            JOIN TranscriptSegments ts ON ts.SessionId = m.SessionId
            WHERE ts.Text LIKE @q
            GROUP BY m.SessionId
            ORDER BY m.StartTime DESC
            LIMIT 200;",
            new { q = $"%{query}%" });

        return rows.Select(r => new TranscriptSearchHit
        {
            SessionId = r.SessionId,
            Subject = r.Subject,
            Platform = r.Platform,
            StartTime = DateTime.Parse(r.StartTime),
            Snippet = Truncate(r.Snippet, 240),
            SegmentStart = TimeSpan.FromSeconds(r.SegmentStart),
            SpeakerName = r.SpeakerName,
            MatchCount = r.MatchCount
        }).ToList();
    }

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? string.Empty : (s.Length <= max ? s : s.Substring(0, max) + "…");

    private static MeetingRow ToRow(MeetingSession s) => new()
    {
        SessionId = s.SessionId,
        Platform = s.Platform,
        Subject = s.Subject,
        StartTime = s.StartTime.ToString("o"),
        EndTime = s.EndTime?.ToString("o"),
        DurationSeconds = s.DurationSeconds,
        WindowTitle = s.WindowTitle,
        ProcessName = s.ProcessName,
        FolderPath = s.FolderPath,
        AudioMePath = s.AudioMePath,
        AudioOthersPath = s.AudioOthersPath,
        AudioCombinedPath = s.AudioCombinedPath,
        MetadataPath = s.MetadataPath,
        TranscriptMarkdownPath = s.TranscriptMarkdownPath,
        TranscriptJsonPath = s.TranscriptJsonPath,
        SpeakersJsonPath = s.SpeakersJsonPath,
        Organizer = s.Organizer,
        MeetingUrl = s.MeetingUrl,
        Notes = s.Notes,
        Status = s.Status.ToString()
    };

    private static MeetingSession FromRow(MeetingRow r) => new()
    {
        SessionId = r.SessionId,
        Platform = r.Platform,
        Subject = r.Subject,
        StartTime = DateTime.Parse(r.StartTime),
        EndTime = string.IsNullOrEmpty(r.EndTime) ? null : DateTime.Parse(r.EndTime!),
        WindowTitle = r.WindowTitle,
        ProcessName = r.ProcessName,
        FolderPath = r.FolderPath,
        AudioMePath = r.AudioMePath,
        AudioOthersPath = r.AudioOthersPath,
        AudioCombinedPath = r.AudioCombinedPath,
        MetadataPath = r.MetadataPath,
        TranscriptMarkdownPath = r.TranscriptMarkdownPath,
        TranscriptJsonPath = r.TranscriptJsonPath,
        SpeakersJsonPath = r.SpeakersJsonPath,
        Organizer = r.Organizer,
        MeetingUrl = r.MeetingUrl,
        Notes = r.Notes,
        Status = Enum.TryParse<MeetingSessionStatus>(r.Status, out var st) ? st : MeetingSessionStatus.Detected
    };

    private class MeetingRow
    {
        public string SessionId { get; set; } = string.Empty;
        public string Platform { get; set; } = string.Empty;
        public string Subject { get; set; } = string.Empty;
        public string StartTime { get; set; } = string.Empty;
        public string? EndTime { get; set; }
        public double DurationSeconds { get; set; }
        public string? WindowTitle { get; set; }
        public string? ProcessName { get; set; }
        public string FolderPath { get; set; } = string.Empty;
        public string? AudioMePath { get; set; }
        public string? AudioOthersPath { get; set; }
        public string? AudioCombinedPath { get; set; }
        public string? MetadataPath { get; set; }
        public string? TranscriptMarkdownPath { get; set; }
        public string? TranscriptJsonPath { get; set; }
        public string? SpeakersJsonPath { get; set; }
        public string? Organizer { get; set; }
        public string? MeetingUrl { get; set; }
        public string? Notes { get; set; }
        public string Status { get; set; } = "Detected";
    }

    private class SearchRow
    {
        public string SessionId { get; set; } = string.Empty;
        public string Subject { get; set; } = string.Empty;
        public string Platform { get; set; } = string.Empty;
        public string StartTime { get; set; } = string.Empty;
        public string Snippet { get; set; } = string.Empty;
        public double SegmentStart { get; set; }
        public string? SpeakerName { get; set; }
        public int MatchCount { get; set; }
    }
}
