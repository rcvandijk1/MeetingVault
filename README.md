# MeetingVault

Local-first Windows 11 desktop app that detects active online meetings,
records the meeting audio, transcribes it with Whisper, identifies separate
speakers, lets the user assign real names to detected speakers, and stores
everything in a clean folder structure under `Documents\MeetingVault`.

> No cloud is required. Audio, transcripts, and metadata live entirely on the
> user's machine.

## Requirements

- Windows 11 (Windows 10 1809+ should also work)
- .NET 8 SDK (Desktop / WPF workload)
- Visual Studio 2022 17.8+ recommended
- A working microphone and a working render device for WASAPI loopback

## Solution layout

```
MeetingVault.sln
└── src
    ├── MeetingVault.Core             — models, configuration, service interfaces
    ├── MeetingVault.Infrastructure   — NAudio capture, Whisper, SQLite, JSON stores
    └── MeetingVault.App              — WPF UI, ViewModels, tray
```

This is clean architecture in spirit: the WPF app and Infrastructure both
depend on Core, but Core depends on nothing except logging abstractions.

## Build / run

```powershell
git clone <this repo>
cd MeetingVault
dotnet restore
dotnet build -c Release
dotnet run --project src/MeetingVault.App -c Release
```

On first run:

1. The app shows a privacy acknowledgement (it is recording your audio — make
   sure you're allowed to).
2. It creates `Documents\MeetingVault` with `Meetings`, `SpeakerProfiles`,
   `Database`, and `Logs` subfolders.
3. The first time you transcribe a meeting it will download the Whisper
   `ggml-small.bin` model (~480 MB) into
   `%LOCALAPPDATA%\MeetingVault\Models` unless you provided a model path in
   Settings.

## Required NuGet packages

| Project | Package | Purpose |
|---|---|---|
| Core | Microsoft.Extensions.Logging.Abstractions | logging interfaces |
| Core | Microsoft.Extensions.DependencyInjection.Abstractions | DI interfaces |
| Infrastructure | NAudio + NAudio.Wasapi | mic + WASAPI loopback capture |
| Infrastructure | Whisper.net + Whisper.net.Runtime | local Whisper inference |
| Infrastructure | Microsoft.Data.Sqlite + Dapper | SQLite index DB |
| App | CommunityToolkit.Mvvm | MVVM (`[ObservableProperty]`, `[RelayCommand]`) |
| App | Microsoft.Extensions.Hosting | DI container |
| App | H.NotifyIcon.Wpf | system tray |

## Whisper model placement

Whisper.NET expects a `ggml-*.bin` model file. You have two options:

1. **Auto-download** (default): leave the *Whisper model path* setting blank.
   On first transcription the app downloads `ggml-small.bin` into
   `%LOCALAPPDATA%\MeetingVault\Models\ggml-small.bin`.
2. **Bring your own**: download a model from the official Whisper repos (e.g.
   `ggml-base.en.bin`, `ggml-medium.bin`, `ggml-large-v3.bin`) and point the
   *Whisper model path* setting at the file. Bigger models = better accuracy
   but slower and more RAM.

The default of `Small` is a reasonable accuracy/speed tradeoff for an MVP
and is what's used as the smoke test.

## Folder layout produced per meeting

```
Documents
└── MeetingVault
    ├── SpeakerProfiles
    ├── Database
    │   └── meetingvault.db
    ├── Logs
    └── Meetings
        └── 2026
            └── 04
                └── 2026-04-28_14-15_Untitled_Meeting_Teams
                    ├── metadata.json
                    ├── transcript.md
                    ├── transcript.json
                    ├── speakers.json
                    ├── audio-me.wav
                    ├── audio-others.wav
                    ├── audio-combined.wav
                    └── speakers/
                        └── spk_001_sample.wav
```

## Phases implemented

- **Phase 1** — WPF shell, settings store, folder creation, manual
  start/stop, microphone + WASAPI loopback capture, mixed `audio-combined.wav`.
- **Phase 2** — process / window-title meeting detection (Teams, Zoom, Google
  Meet via Chrome/Edge), tray support, `metadata.json` generation, history
  screen with editable subject/platform/organizer/notes, open folder /
  transcript actions.
- **Phase 3** — Whisper.NET transcription, `transcript.json`, `transcript.md`,
  progress reporting in the dashboard.
- **Phase 4** — `ISpeakerDiarizationService` abstraction with a
  `StubSpeakerDiarizationService` (silence-gap heuristic) **and** a
  `PythonDiarizationService` that shells out to a bundled
  `meetingvault_diarize.py` running `pyannote.audio` for real diarization
  and voice embeddings. A `DiarizationServiceRouter` picks between them at
  runtime based on a setting and falls back to the stub if the sidecar
  fails. Speaker review screen with rename / mark-as-me / ignore / merge /
  save-profile actions; saving the review re-renders `transcript.md` with
  real names. **Auto-recognition**: when pyannote is enabled and a speaker
  has been named in a previous meeting, their voiceprint is saved into
  `SpeakerProfiles\*.json` and matched by cosine similarity in subsequent
  meetings — known speakers are pre-named in the review screen with a
  green "Auto-recognized (NN% match)" badge.
- **Phase 5** — SQLite index (`Meetings`, `TranscriptSegments`, `Speakers`,
  `SpeakerProfiles`, `AppSettings`) for history listing and filtering, plus a
  **Search** view that runs `LIKE`-based full-text-ish search across all
  segments and shows a snippet, the matching speaker, and the timestamp.
  Renaming a speaker in the review screen updates both the JSON files **and**
  the SQLite index so search results show the real name.

Additional behaviours that span the phases:

- **Auto-start recording** when detection confidence is ≥ 70% and the user
  has enabled it in Settings. Auto-start is suppressed until detection drops
  to "no meeting" again, so leaving and re-joining a meeting starts a fresh
  session instead of appending to the previous one.
- **Tray recording indicator** — the tray tooltip and the window title
  reflect the coordinator state (Recording / Transcribing / Awaiting review).
- **Raw audio cleanup** — when *Keep raw audio* is unchecked, the per-source
  `audio-me.wav` and `audio-others.wav` are deleted after a successful
  transcription, leaving only the combined mix.
- **Calendar correlation** — `ICalendarCorrelationService` is consulted on
  Stop to optionally fill in subject / organizer / attendees / meeting URL.
  The default registration is a no-op (`NullCalendarCorrelationService`); a
  real Outlook implementation should swap it in DI when ready.

## Speaker recognition (pyannote.audio sidecar)

The default diarization engine is the silence-gap stub. To enable real
diarization **and** automatic recognition of people you've named before:

1. Install Python 3.10+ and the dependencies in
   `src/MeetingVault.App/Resources/python/requirements.txt`:

   ```powershell
   python -m pip install -r src/MeetingVault.App/Resources/python/requirements.txt
   ```

   This pulls in PyTorch and `pyannote.audio` (~2 GB). A CUDA-capable GPU
   is optional but speeds diarization up roughly 5×.

2. Create a Hugging Face account, get a token at
   <https://huggingface.co/settings/tokens>, and accept the model conditions
   on each of:
   - <https://huggingface.co/pyannote/speaker-diarization-3.1>
   - <https://huggingface.co/pyannote/embedding>

3. Open MeetingVault → **Settings → Speaker recognition**:
   - Set *Engine* to **Python**.
   - Browse to `python.exe`.
   - Paste the Hugging Face token.
   - Pick a *Voice match threshold* (0.70 is a good starting point — raise
     for stricter matching, lower if real people aren't being recognized).
   - Leave *Auto-enroll voices when I name a speaker* on.

4. Record a meeting. After transcription:
   - For new people, type a real name in the review screen and click
     **Save and regenerate transcript**. Their voice embedding is stored in
     `Documents\MeetingVault\SpeakerProfiles\spk_<name>.json`.
   - In future meetings, the same voice is auto-named with a green
     "Auto-recognized" badge — no manual action required.

If anything goes wrong (Python missing, model not licensed, sidecar crash)
the app falls back to the stub diarization automatically and the meeting
still ends up with a transcript you can review by hand.

## Known limitations

- The default `StubSpeakerDiarizationService` does NOT recognize anyone — it
  only guesses speaker boundaries from silence gaps. Enable the Python
  sidecar (above) for real diarization and recognition.
- The Python sidecar requires a one-time ~2 GB install (PyTorch +
  pyannote). On a CPU, expect ~30s of diarization per 5 minutes of audio.
- Meeting subject / attendees are not auto-populated. They come from the
  window title and are user-editable in History. Calendar integration is a
  Phase-6 enhancement.
- Browser URL detection for Google Meet is approximate — we look at the
  window title (`meet.google.com`, `Google Meet`, etc.). Reading the actual
  URL would need a browser extension or UI Automation.
- Bluetooth headsets running in HFP/HSP mode collapse to a low-quality mono
  stream. Use A2DP for the speaker side and a separate mic if possible. The
  app picks the **default communications** endpoints, which is what Teams and
  Zoom use, so it follows the user's voice routing.
- WASAPI loopback captures whatever Windows is rendering — including system
  notifications and music. Mute other apps if you don't want them in the
  transcript.

## Future enhancements

The architecture is designed to absorb these without rewrites:

- Outlook / Google Calendar correlation to populate subject + attendees.
- Teams Graph and Zoom API metadata enrichment.
- Real diarization via Python sidecar (pyannote.audio) and voice embeddings
  for cross-meeting speaker recognition.
- Post-meeting AI summary and action-item extraction.
- Full-text search across transcripts (the SQLite schema already has the
  `TranscriptSegments` table).
- Export to Word / PDF.
- Encryption at rest.
- Enterprise policy settings (mandatory acknowledgement, central log path,
  retention rules).

## Privacy

The app records and transcribes meetings entirely on the local machine.
No data is sent to any cloud service. Use it only where you are allowed to
record. The first-run dialog records your acknowledgement of this.
