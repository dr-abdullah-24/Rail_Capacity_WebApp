"""In-memory pub/sub for streaming run progress to WebSocket clients.

Design: a run's log is both broadcast in real time to any connected
subscribers AND persisted in an in-memory list so a late-connecting
subscriber can see the full history.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class RunChannel:
    log: list[dict] = field(default_factory=list)
    subscribers: set[asyncio.Queue] = field(default_factory=set)
    done: bool = False


class Broker:
    def __init__(self) -> None:
        self._channels: dict[int, RunChannel] = {}
        self._lock = asyncio.Lock()

    async def _channel(self, run_id: int) -> RunChannel:
        async with self._lock:
            if run_id not in self._channels:
                self._channels[run_id] = RunChannel()
            return self._channels[run_id]

    async def publish(self, run_id: int, message: dict) -> None:
        ch = await self._channel(run_id)
        ch.log.append(message)
        for q in list(ch.subscribers):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass

    async def complete(self, run_id: int) -> None:
        ch = await self._channel(run_id)
        ch.done = True
        for q in list(ch.subscribers):
            try:
                q.put_nowait({"type": "done"})
            except asyncio.QueueFull:
                pass

    async def subscribe(self, run_id: int, replay: bool = True):
        """Yield existing log then live messages. Ends when channel is done
        AND no more messages queued."""
        ch = await self._channel(run_id)
        q: asyncio.Queue = asyncio.Queue(maxsize=1024)
        # Replay history first
        if replay:
            for entry in list(ch.log):
                yield entry
        ch.subscribers.add(q)
        try:
            while True:
                if ch.done and q.empty():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if ch.done:
                        break
                    continue
                if msg.get("type") == "done":
                    break
                yield msg
        finally:
            ch.subscribers.discard(q)


broker = Broker()
