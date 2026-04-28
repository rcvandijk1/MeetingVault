# Architecture

MeetingVault is split into three projects that follow a clean-architecture
dependency rule (UI → Infrastructure → Core; Core depends on nothing
domain-specific).

```
┌───────────────────┐
│ MeetingVault.App  │  WPF Views + ViewModels, DI bootstrap, tray
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ MeetingVault.     │  NAudio capture, Whisper, SQLite, JSON stores,
│ Infrastructure    │  process/window detection, RecordingCoordinator
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ MeetingVault.Core │  Models, configuration types, service interfaces
└───────────────────┘
```

## Service surface (Core)

| Interface | Responsibility |
|---|---|
| `IPathService` | Resolves `Documents\MeetingVault` and per-meeting folders, sanitizes folder names |
| `ISettingsStore` | Loads / saves `AppSettings` JSON |
| `IAudioCaptureService` | Starts/stops capture; emits state, levels, errors |
| `IMeetingDetector` | One-shot detection result |
| `IMeetingDetectionMonitor` | Background polling + change events |
| `IMetadataWriter` | Writes/reads `metadata.json` |
| `ITranscriptionService` | Whisper inference; returns `TranscriptionSegment` list |
| `ITranscriptWriter` | Writes/reads `transcript.json`, renders `transcript.md` |
| `ISpeakerDiarizationService` | Returns labelled speakers + annotated segments |
| `ISpeakerStore` | Reads/writes `speakers.json` |
| `ISpeakerProfileStore` | Reusable speaker profiles in `SpeakerProfiles\*.json` |
| `IMeetingSessionStore` | SQLite-backed history index |
| `IRecordingCoordinator` | Orchestrates the meeting lifecycle |

## Recording lifecycle

```
StartAsync(detection)
  └─ create per-meeting folder under Meetings/YYYY/MM
  └─ IAudioCaptureService.StartAsync (mic + loopback + combined mix)
  └─ IMetadataWriter.WriteAsync (initial metadata.json)
  └─ IMeetingSessionStore.CreateAsync (DB row, status=Recording)

StopAsync
  └─ IAudioCaptureService.StopAsync (flush WAV writers)
  └─ IMetadataWriter.WriteAsync (with EndTime)
  └─ IMeetingSessionStore.UpdateAsync (status=Stopped)

TranscribeAsync(session)
  └─ choose audio (combined > others > mic)
  └─ ITranscriptionService.TranscribeAsync → segments
  └─ ISpeakerDiarizationService.DiarizeAsync → annotated segments + speakers
  └─ Write transcript.json, speakers.json, transcript.md
  └─ Status = AwaitingSpeakerReview
  └─ Dashboard navigates to Speaker Review screen
```

## Replacing the diarization stub

To plug in a real diarization engine (e.g. pyannote.audio via a Python
sidecar), implement `ISpeakerDiarizationService` and swap the registration in
`App.xaml.cs`:

```csharp
services.AddSingleton<ISpeakerDiarizationService, PythonDiarizationService>();
```

`PythonDiarizationService` is scaffolded as a placeholder and currently
throws `NotImplementedException`.
