"""Mock OpenAI-compatible chat completions server for pipeline tests.

Streams a canned reply so the full voice loop can be verified without
any external API or key.
"""

import asyncio
import json
import time
import uuid

from fastapi import FastAPI
from fastapi.responses import StreamingResponse

CANNED_REPLY = "That sounds wonderful. Tell me more about it."


def create_mock_llm() -> FastAPI:
    app = FastAPI()

    @app.get("/v1/models")
    async def models():
        return {"data": [{"id": "mock-model", "object": "model"}]}

    @app.post("/v1/chat/completions")
    async def chat(body: dict):
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

        if not body.get("stream", False):
            return {
                "id": completion_id,
                "object": "chat.completion",
                "created": int(time.time()),
                "model": body.get("model", "mock-model"),
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": CANNED_REPLY},
                        "finish_reason": "stop",
                    }
                ],
            }

        async def stream():
            words = CANNED_REPLY.split(" ")
            for i, word in enumerate(words):
                chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": body.get("model", "mock-model"),
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": word + (" " if i < len(words) - 1 else "")},
                            "finish_reason": None,
                        }
                    ],
                }
                yield f"data: {json.dumps(chunk)}\n\n"
                await asyncio.sleep(0.01)
            done = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": body.get("model", "mock-model"),
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(done)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    return app
