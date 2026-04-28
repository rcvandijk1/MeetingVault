# Setup

## Prerequisites

- Windows 10 1809+ (Windows 11 recommended)
- .NET 8 SDK with the Desktop / WPF workload
- Visual Studio 2022 17.8+ (or `dotnet build` from CLI)

Optional but recommended:

- A discrete microphone and a render device that supports communications
  audio (Teams / Zoom expect this).

## First build

```powershell
dotnet restore
dotnet build -c Release
```

Visual Studio will prompt you to install the `WPF / Desktop` workload if
it's not already present.

## Running

```powershell
dotnet run --project src/MeetingVault.App -c Release
```

Or open `MeetingVault.sln` in Visual Studio and start `MeetingVault.App`.

## First-run experience

1. The privacy acknowledgement dialog appears. Click OK to continue. This is
   recorded in `%LOCALAPPDATA%\MeetingVault\settings.json`.
2. The app creates the folder layout under `Documents\MeetingVault`.
3. Start a quick test by clicking **Start Recording** — speak into your mic
   and play something on your speakers.
4. Click **Stop Recording**. Transcription kicks off automatically and a
   small Whisper model is downloaded the very first time (this can take a
   few minutes on a slow connection).

## Whisper models

Place a `ggml-*.bin` model anywhere you like and point the
*Whisper model path* setting at it. Suggested choices:

| Model | Size | Notes |
|---|---|---|
| `ggml-tiny.bin` | ~75 MB | Fast on any laptop, lower accuracy |
| `ggml-base.en.bin` | ~140 MB | Good for English-only fast transcription |
| `ggml-small.bin` | ~480 MB | **Auto-downloaded default** |
| `ggml-medium.bin` | ~1.5 GB | Solid accuracy, needs a real CPU |
| `ggml-large-v3.bin` | ~3 GB | Best accuracy, slow on CPU |

GPU acceleration (CUDA) is supported by `Whisper.net.Runtime.Cuda`. To use
it, replace `Whisper.net.Runtime` with `Whisper.net.Runtime.Cuda` in
`MeetingVault.Infrastructure.csproj` and ensure CUDA is installed.

## Troubleshooting

- **"No microphone device available"** — check Windows Sound settings; the
  default *communications* input must be set to a real device.
- **No system audio in `audio-others.wav`** — make sure something is
  actually playing through the *communications* output. Some headsets
  enumerate as multimedia-only.
- **Whisper download is slow / blocked** — manually download a model and
  set the path in Settings.
- **Antivirus blocks Whisper.net runtime** — `Whisper.net.Runtime` ships
  native binaries under `runtimes\win-x64\native\whisper.dll`. Allow that
  file in your AV.
