"""
MeetingVault diarization sidecar.

Invoked by the .NET app:

    python meetingvault_diarize.py < request.json > response.json

Request (stdin, JSON):
    {
        "audio_path": "C:\\...\\audio-combined.wav",
        "speakers_folder": "C:\\...\\meeting_folder\\speakers",
        "whisper_segments": [
            { "segment_id": "abc", "start": 0.0, "end": 3.2, "text": "..." }
        ],
        "known_voiceprints": [
            { "speaker_id": "spk_robert",
              "display_name": "Robert",
              "embedding": [0.1, 0.2, ...],
              "embedding_model": "pyannote/embedding" }
        ],
        "match_threshold": 0.7,
        "hf_token": "hf_xxx",
        "min_speakers": null,
        "max_speakers": null
    }

Response (stdout, JSON):
    {
        "engine": "pyannote.audio",
        "engine_version": "...",
        "embedding_model": "pyannote/embedding",
        "speakers": [
            { "speaker_id": "SPEAKER_00", "display_name": "Robert",
              "is_known": true, "confidence": 0.83,
              "first_seen_seconds": 12.3, "total_speaking_seconds": 45.2,
              "sample_audio_path": "...wav",
              "embedding": [...] }
        ],
        "segments": [
            { "segment_id": "abc", "start": 0.0, "end": 3.2,
              "speaker_id": "SPEAKER_00", "text": "..." }
        ],
        "notes": "..."
    }

Errors are written to stderr and the process exits with a non-zero status
code; the C# caller falls back to its stub diarization in that case.
"""

import json
import os
import sys
import traceback
from pathlib import Path


def _err(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _read_request() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise RuntimeError("Empty request on stdin")
    return json.loads(raw)


def _cosine(a, b) -> float:
    import numpy as np
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) or 1e-9
    return float(np.dot(a, b) / denom)


def _write_sample(audio_path: str, speakers_folder: str, speaker_id: str,
                  start: float, max_seconds: float = 8.0) -> str | None:
    """Cuts a short WAV sample for the speaker so the user can audition it."""
    try:
        import soundfile as sf
        os.makedirs(speakers_folder, exist_ok=True)
        data, sr = sf.read(audio_path)
        i0 = int(max(0, start) * sr)
        i1 = min(len(data), i0 + int(max_seconds * sr))
        if i1 <= i0:
            return None
        out = Path(speakers_folder) / f"{speaker_id}_sample.wav"
        sf.write(str(out), data[i0:i1], sr)
        return str(out)
    except Exception as ex:
        _err(f"sample write failed for {speaker_id}: {ex}")
        return None


def _load_pipeline(hf_token: str | None):
    """Loads the pyannote diarization pipeline (downloads weights on first use)."""
    from pyannote.audio import Pipeline
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token if hf_token else True,
    )
    # Move to GPU if available — diarization is the slowest part of the pipeline.
    try:
        import torch
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
    except Exception:
        pass
    return pipeline


def _load_embedder(hf_token: str | None):
    from pyannote.audio import Inference
    inference = Inference("pyannote/embedding",
                          window="whole",
                          use_auth_token=hf_token if hf_token else True)
    try:
        import torch
        if torch.cuda.is_available():
            inference.to(torch.device("cuda"))
    except Exception:
        pass
    return inference


def _embed_speaker(embedder, audio_path: str, segments_for_speaker):
    """Returns a single embedding for a speaker by averaging per-segment embeddings."""
    import numpy as np
    import torch
    vectors = []
    for seg in segments_for_speaker:
        try:
            from pyannote.core import Segment
            chunk = Segment(seg["start"], seg["end"])
            emb = embedder.crop(audio_path, chunk)
            # Inference returns (1, dim) or (dim,) depending on version.
            arr = emb.data if hasattr(emb, "data") else emb
            arr = np.asarray(arr, dtype=np.float32).reshape(-1)
            if arr.size > 0:
                vectors.append(arr)
        except Exception as ex:
            _err(f"embedding crop failed: {ex}")
    if not vectors:
        return None
    stacked = np.stack(vectors, axis=0)
    avg = stacked.mean(axis=0)
    # L2-normalize so cosine matches against stored profiles are stable.
    norm = np.linalg.norm(avg) or 1e-9
    return (avg / norm).tolist()


def _attribute_segments(whisper_segments, diar_intervals):
    """Maps each Whisper segment to the diarization speaker whose intervals
    overlap it the most. Whisper segments that don't overlap any speaker are
    left unassigned."""
    out = []
    for seg in whisper_segments:
        ws, we = float(seg["start"]), float(seg["end"])
        best_id, best_overlap = None, 0.0
        for spk, intervals in diar_intervals.items():
            for s, e in intervals:
                overlap = max(0.0, min(we, e) - max(ws, s))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_id = spk
        out.append({
            "segment_id": seg.get("segment_id"),
            "start": ws,
            "end": we,
            "text": seg.get("text", ""),
            "speaker_id": best_id,
        })
    return out


def main() -> int:
    try:
        req = _read_request()
    except Exception as ex:
        _err(f"Failed to read request: {ex}")
        return 2

    audio_path = req.get("audio_path")
    if not audio_path or not os.path.exists(audio_path):
        _err(f"audio_path missing or not found: {audio_path}")
        return 2

    speakers_folder = req.get("speakers_folder", "")
    whisper_segments = req.get("whisper_segments", []) or []
    known = req.get("known_voiceprints", []) or []
    threshold = float(req.get("match_threshold", 0.7))
    hf_token = req.get("hf_token") or os.environ.get("HF_TOKEN")

    try:
        pipeline = _load_pipeline(hf_token)
    except Exception as ex:
        _err("Failed to load pyannote pipeline. Did you accept the model "
             "license at https://huggingface.co/pyannote/speaker-diarization-3.1 "
             "and provide a HF token?")
        _err(traceback.format_exc())
        return 3

    diar_kwargs = {}
    if req.get("min_speakers") is not None:
        diar_kwargs["min_speakers"] = int(req["min_speakers"])
    if req.get("max_speakers") is not None:
        diar_kwargs["max_speakers"] = int(req["max_speakers"])

    try:
        annotation = pipeline(audio_path, **diar_kwargs)
    except Exception as ex:
        _err(f"Diarization failed: {ex}")
        _err(traceback.format_exc())
        return 4

    # Group diarization intervals by speaker label.
    diar_intervals: dict[str, list[tuple[float, float]]] = {}
    speaker_first_seen: dict[str, float] = {}
    speaker_total: dict[str, float] = {}
    for turn, _track, label in annotation.itertracks(yield_label=True):
        diar_intervals.setdefault(label, []).append((turn.start, turn.end))
        speaker_first_seen.setdefault(label, turn.start)
        speaker_total[label] = speaker_total.get(label, 0.0) + (turn.end - turn.start)

    # Embed each speaker (mean over their intervals).
    try:
        embedder = _load_embedder(hf_token)
    except Exception as ex:
        _err(f"Failed to load embedding model: {ex}")
        embedder = None

    speakers_out = []
    for label, intervals in diar_intervals.items():
        embedding = None
        if embedder is not None:
            try:
                embedding = _embed_speaker(
                    embedder, audio_path,
                    [{"start": s, "end": e} for s, e in intervals[:20]])
            except Exception as ex:
                _err(f"embed_speaker failed for {label}: {ex}")

        display_name = None
        is_known = False
        confidence = 0.5  # baseline confidence in the diarization label itself
        if embedding is not None and known:
            best_match, best_score = None, -1.0
            for prof in known:
                if prof.get("embedding_model") and prof["embedding_model"] != "pyannote/embedding":
                    continue
                prof_emb = prof.get("embedding")
                if not prof_emb:
                    continue
                score = _cosine(embedding, prof_emb)
                if score > best_score:
                    best_score = score
                    best_match = prof
            if best_match is not None and best_score >= threshold:
                display_name = best_match["display_name"]
                is_known = True
                confidence = float(best_score)

        sample_path = _write_sample(audio_path, speakers_folder, label,
                                    speaker_first_seen.get(label, 0.0))

        speakers_out.append({
            "speaker_id": label,
            "display_name": display_name,
            "is_known": is_known,
            "confidence": confidence,
            "first_seen_seconds": speaker_first_seen.get(label, 0.0),
            "total_speaking_seconds": speaker_total.get(label, 0.0),
            "sample_audio_path": sample_path,
            "embedding": embedding,
        })

    segments_out = _attribute_segments(whisper_segments, diar_intervals)

    try:
        import pyannote.audio as pa
        engine_version = getattr(pa, "__version__", "unknown")
    except Exception:
        engine_version = "unknown"

    response = {
        "engine": "pyannote.audio",
        "engine_version": engine_version,
        "embedding_model": "pyannote/embedding",
        "speakers": speakers_out,
        "segments": segments_out,
        "notes": ("Diarization by pyannote/speaker-diarization-3.1; "
                  "embeddings by pyannote/embedding."),
    }

    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:
        _err(f"Unhandled error: {ex}")
        _err(traceback.format_exc())
        sys.exit(1)
