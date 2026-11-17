"""FastAPI control plane + per-session WebSocket endpoint.

One process serves everything: health, session creation, the audio
websocket, post-session extraction, and graceful shutdown.
"""

import asyncio
import time
from contextlib import asynccontextmanager
import uuid

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from loguru import logger

from parla_voice import __version__
from parla_voice.config import LLMConfig, SessionConfig
from parla_voice.extraction import ExtractRequest

# Session configs parked between POST /sessions and the WS connect.
# A config not claimed within this window is dropped.
SESSION_CLAIM_TIMEOUT_S = 60


class PendingSession:
    def __init__(self, config: SessionConfig):
        self.config = config
        self.created_at = time.monotonic()
        self.session_id = uuid.uuid4().hex[:12]


def create_app() -> FastAPI:
    from parla_voice.engines import Engines

    engines = Engines()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        # Engines load in the background so /health answers immediately.
        load_task = asyncio.create_task(engines.load())
        try:
            yield
        finally:
            load_task.cancel()
            engines.close()

    app = FastAPI(title="parla-voice", version=__version__, lifespan=lifespan)
    pending: dict[str, PendingSession] = {}
    active: set[str] = set()

    def prune_pending() -> None:
        now = time.monotonic()
        for sid in [
            sid
            for sid, s in pending.items()
            if now - s.created_at > SESSION_CLAIM_TIMEOUT_S
        ]:
            del pending[sid]

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "version": __version__,
            "models": app.state.model_status(),
            "active_sessions": len(active),
        }

    @app.post("/sessions")
    async def create_session(config: SessionConfig):
        prune_pending()
        session = PendingSession(config)
        pending[session.session_id] = session
        logger.info(
            "session created id={} chat={} llm={}/{} tts={}",
            session.session_id,
            config.chat_id,
            config.llm.provider,
            config.llm.model,
            config.voice.engine,
        )
        return {
            "session_id": session.session_id,
            "ws_url": f"ws://127.0.0.1:{app.state.port}/ws/{session.session_id}",
        }

    @app.websocket("/ws/{session_id}")
    async def session_ws(websocket: WebSocket, session_id: str):
        session = pending.pop(session_id, None)
        if session is None:
            await websocket.close(code=4404, reason="unknown session")
            return
        await websocket.accept()
        active.add(session_id)
        try:
            await app.state.run_session(websocket, session.config)
        except WebSocketDisconnect:
            logger.info("session {} client disconnected", session_id)
        except Exception:
            logger.exception("session {} crashed", session_id)
        finally:
            active.discard(session_id)
            logger.info("session {} closed", session_id)

    @app.post("/extract")
    async def extract_route(req: "ExtractRequest"):
        from parla_voice.extraction import extract

        try:
            result = await extract(req)
        except Exception as e:
            logger.exception("extraction failed")
            raise HTTPException(status_code=502, detail=str(e))
        return result.model_dump()

    @app.post("/llm/check")
    async def llm_check(cfg: LLMConfig):
        """Validate credentials + model without generating tokens (free)."""
        if cfg.provider != "anthropic":
            return {"ok": True, "detail": "no check for this provider"}
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=cfg.api_key)
        try:
            model = await client.models.retrieve(cfg.model)
            return {"ok": True, "detail": f"Key works · {model.display_name}"}
        except anthropic.AuthenticationError:
            return {"ok": False, "detail": "Anthropic rejected this API key"}
        except anthropic.NotFoundError:
            return {"ok": False, "detail": f"Unknown model id: {cfg.model}"}
        except anthropic.APIConnectionError:
            return {"ok": False, "detail": "Can't reach api.anthropic.com"}
        except anthropic.APIStatusError as e:
            return {"ok": False, "detail": f"Anthropic API error {e.status_code}"}
        finally:
            await client.close()

    @app.post("/shutdown")
    async def shutdown():
        logger.info("shutdown requested")
        asyncio.get_event_loop().call_later(0.2, app.state.stop)
        return {"status": "stopping"}

    # --- Sessions run the real pipeline once the engines are loaded ---

    async def run_pipeline_session(websocket: WebSocket, config: SessionConfig):
        from parla_voice.pipeline import run_session

        try:
            await engines.wait_ready()
        except asyncio.TimeoutError:
            await websocket.close(code=4503, reason="voice engines failed to load")
            return
        actual_engine, tts_engine = await engines.resolve_tts(config.voice.engine)
        notices = []
        if actual_engine != config.voice.engine:
            logger.warning(
                "session {} requested tts={} but using {}",
                config.chat_id,
                config.voice.engine,
                actual_engine,
            )
            notices.append(
                "Fish s2-pro server is not running — using Kokoro for this session."
            )
        try:
            await run_session(
                websocket,
                config,
                tts_engine=tts_engine,
                stt_client=engines.parakeet,
                notices=notices,
            )
        finally:
            if tts_engine is not engines.kokoro:
                await tts_engine.close()

    app.state.model_status = lambda: engines.status
    app.state.run_session = run_pipeline_session
    app.state.stop = lambda: None
    app.state.port = 8790
    return app
