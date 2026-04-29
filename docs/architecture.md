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

## Diarization & cross-meeting recognition

Two `ISpeakerDiarizationService` implementations ship in the box:

- `StubSpeakerDiarizationService` — silence-gap heuristic, no recognition.
- `PythonDiarizationService` — spawns `python meetingvault_diarize.py` and
  reads a JSON response from stdout. Pyannote diarizes the combined WAV and
  produces a 192-d voice embedding per speaker. The C# side compares each
  embedding against `SpeakerProfiles\*.json` and applies the matched name
  when cosine similarity ≥ `SpeakerMatchThreshold`.

`DiarizationServiceRouter` is the only registration consumers see; it picks
between the two based on `AppSettings.DiarizationEngine` and falls back to
the stub if the python path fails.

### Recognition feedback loop

```
Meeting #1
  Whisper segments + Pyannote diarization → Speaker { Embedding=[...] }
  User names speaker "Robert" + saves
  → SpeakerProfile spk_robert.json with embedding stored under SpeakerProfiles\

Meeting #2
  Pyannote diarization is given the list of known voiceprints from disk
  Each new speaker's embedding is compared (cosine) against every profile
  Best match ≥ threshold → speaker.IsKnown = true, DisplayName = "Robert"
  Review screen shows "Auto-recognized (NN% match)" — no rename needed
```

The sidecar contract is JSON-on-stdin/JSON-on-stdout (see
`PythonDiarizationService.SidecarRequest/Response` and the docstring in
`meetingvault_diarize.py`). To plug in a different engine (e.g. SpeechBrain,
NeMo, AssemblyAI) implement `ISpeakerDiarizationService` and either replace
`PythonDiarizationService` in DI or extend the router with a new branch.
