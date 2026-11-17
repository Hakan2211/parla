"""Parakeet recognizer in a dedicated child process.

sherpa-onnx bundles its own onnxruntime DLL which collides with the
onnxruntime the rest of the pipeline uses (Silero VAD, smart-turn) when
both live in one Windows process. So sherpa_onnx is imported ONLY here,
in a spawned child; the parent talks to it over pipes.

Protocol: parent sends PCM16 mono 16kHz bytes, child replies with the
transcript string. None shuts the child down.
"""

import multiprocessing as mp
from multiprocessing.connection import Connection
from pathlib import Path

DEFAULT_MODEL_DIR = (
    Path(__file__).resolve().parents[3]
    / "models"
    / "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
)


def _worker_main(conn: Connection, model_dir: str) -> None:
    import numpy as np
    import sherpa_onnx

    model = Path(model_dir)
    recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=str(model / "encoder.int8.onnx"),
        decoder=str(model / "decoder.int8.onnx"),
        joiner=str(model / "joiner.int8.onnx"),
        tokens=str(model / "tokens.txt"),
        num_threads=4,
        model_type="nemo_transducer",
    )
    conn.send("ready")
    while True:
        audio = conn.recv()
        if audio is None:
            break
        samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        conn.send(stream.result.text.strip())


class ParakeetClient:
    """Parent-side handle. `transcribe` is blocking — call from an executor."""

    def __init__(self, model_dir: Path = DEFAULT_MODEL_DIR):
        ctx = mp.get_context("spawn")
        self._conn, child_conn = ctx.Pipe()
        self._process = ctx.Process(
            target=_worker_main, args=(child_conn, str(model_dir)), daemon=True
        )
        self._process.start()
        self._lock = mp.Lock()

    def wait_ready(self, timeout: float = 120) -> None:
        if not self._conn.poll(timeout):
            raise TimeoutError("parakeet worker did not become ready")
        assert self._conn.recv() == "ready"

    def transcribe(self, audio: bytes) -> str:
        with self._lock:
            self._conn.send(audio)
            return self._conn.recv()

    def close(self) -> None:
        try:
            self._conn.send(None)
        except (BrokenPipeError, OSError):
            pass
        self._process.join(timeout=3)
        if self._process.is_alive():
            self._process.terminate()
