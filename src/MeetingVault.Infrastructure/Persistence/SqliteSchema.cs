using Microsoft.Data.Sqlite;

namespace MeetingVault.Infrastructure.Persistence;

internal static class SqliteSchema
{
    public const string CreateScript = @"
CREATE TABLE IF NOT EXISTS Meetings (
    SessionId TEXT PRIMARY KEY,
    Platform TEXT NOT NULL,
    Subject TEXT NOT NULL,
    StartTime TEXT NOT NULL,
    EndTime TEXT NULL,
    DurationSeconds REAL NOT NULL DEFAULT 0,
    WindowTitle TEXT NULL,
    ProcessName TEXT NULL,
    FolderPath TEXT NOT NULL,
    AudioMePath TEXT NULL,
    AudioOthersPath TEXT NULL,
    AudioCombinedPath TEXT NULL,
    MetadataPath TEXT NULL,
    TranscriptMarkdownPath TEXT NULL,
    TranscriptJsonPath TEXT NULL,
    SpeakersJsonPath TEXT NULL,
    Organizer TEXT NULL,
    MeetingUrl TEXT NULL,
    Notes TEXT NULL,
    Status TEXT NOT NULL DEFAULT 'Detected'
);

CREATE INDEX IF NOT EXISTS IX_Meetings_StartTime ON Meetings(StartTime);
CREATE INDEX IF NOT EXISTS IX_Meetings_Platform ON Meetings(Platform);

CREATE TABLE IF NOT EXISTS TranscriptSegments (
    SegmentId TEXT PRIMARY KEY,
    SessionId TEXT NOT NULL,
    StartSeconds REAL NOT NULL,
    EndSeconds REAL NOT NULL,
    SpeakerId TEXT NULL,
    SpeakerName TEXT NULL,
    Text TEXT NOT NULL,
    Confidence REAL NOT NULL DEFAULT 0,
    SourceAudio TEXT NOT NULL DEFAULT 'Combined',
    FOREIGN KEY (SessionId) REFERENCES Meetings(SessionId) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS IX_Segments_Session ON TranscriptSegments(SessionId);

CREATE TABLE IF NOT EXISTS Speakers (
    SessionId TEXT NOT NULL,
    SpeakerId TEXT NOT NULL,
    DisplayName TEXT NOT NULL,
    IsKnown INTEGER NOT NULL DEFAULT 0,
    Confidence REAL NOT NULL DEFAULT 0,
    TotalSpeakingSeconds REAL NOT NULL DEFAULT 0,
    SampleAudioPath TEXT NULL,
    PRIMARY KEY (SessionId, SpeakerId),
    FOREIGN KEY (SessionId) REFERENCES Meetings(SessionId) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS SpeakerProfiles (
    SpeakerId TEXT PRIMARY KEY,
    DisplayName TEXT NOT NULL,
    Aliases TEXT NULL,
    Notes TEXT NULL,
    VoiceProfileAvailable INTEGER NOT NULL DEFAULT 0,
    CreatedAt TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT NULL
);
";

    public static void EnsureCreated(string connectionString)
    {
        using var conn = new SqliteConnection(connectionString);
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = CreateScript;
        cmd.ExecuteNonQuery();
    }
}
