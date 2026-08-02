"""WebSocket streaming of run progress."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.broker import broker

router = APIRouter(prefix="/ws", tags=["ws"])


@router.websocket("/runs/{run_id}")
async def run_stream(ws: WebSocket, run_id: int):
    await ws.accept()
    try:
        async for message in broker.subscribe(run_id):
            await ws.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await ws.close()
        except RuntimeError:
            pass
