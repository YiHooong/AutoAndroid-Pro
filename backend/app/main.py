from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import adb
from .scrcpy import StreamOptions, stream_mp4_chunks


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"

app = FastAPI(title="AutoAndroid WebUI")
app.mount("/assets", StaticFiles(directory=FRONTEND), name="assets")


class TapPayload(BaseModel):
    x: int = Field(ge=0)
    y: int = Field(ge=0)


class SwipePayload(BaseModel):
    x1: int = Field(ge=0)
    y1: int = Field(ge=0)
    x2: int = Field(ge=0)
    y2: int = Field(ge=0)
    duration_ms: int = Field(default=300, ge=1, le=5000)


class TextPayload(BaseModel):
    text: str


class KeyPayload(BaseModel):
    key: str | int


class ConnectPayload(BaseModel):
    address: str = Field(description="host:port, e.g. 192.168.1.100:5555")


class PairPayload(BaseModel):
    address: str = Field(description="host:port shown in wireless-debugging pairing dialog")
    code: str = Field(description="6-digit pairing code")


@app.get("/")
def index() -> FileResponse:
    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    return FileResponse(FRONTEND / "index.html", headers=headers)


@app.get("/api/devices")
def devices():
    try:
        return {"devices": [device.__dict__ for device in adb.list_devices()]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/connect")
def connect_device(payload: ConnectPayload):
    try:
        message = adb.connect(payload.address)
        return {"ok": True, "message": message}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/pair")
def pair_device(payload: PairPayload):
    try:
        message = adb.pair(payload.address, payload.code)
        return {"ok": True, "message": message}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/devices/{serial}/wm-size")
def wm_size(serial: str):
    try:
        output = adb.shell(serial, "wm size")
        return {"raw": output.strip()}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/devices/{serial}/tap")
def tap(serial: str, payload: TapPayload):
    try:
        adb.tap(serial, payload.x, payload.y)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/devices/{serial}/swipe")
def swipe(serial: str, payload: SwipePayload):
    try:
        adb.swipe(
            serial,
            payload.x1,
            payload.y1,
            payload.x2,
            payload.y2,
            payload.duration_ms,
        )
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/devices/{serial}/text")
def input_text(serial: str, payload: TextPayload):
    try:
        adb.input_text(serial, payload.text)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/devices/{serial}/keyevent")
def keyevent(serial: str, payload: KeyPayload):
    try:
        adb.keyevent(serial, payload.key)
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.websocket("/ws/scrcpy")
async def scrcpy_ws(
    websocket: WebSocket,
    serial: str | None = Query(default=None),
    max_size: int = Query(default=1280, ge=320, le=4096),
    max_fps: int = Query(default=60, ge=0),
    bit_rate: str = Query(default="8M"),
):
    await websocket.accept()
    try:
        device = adb.require_device(serial)
        options = StreamOptions(
            max_size=max_size,
            max_fps=max_fps,
            video_bit_rate=bit_rate,
        )
        count = 0
        from .scrcpy import stream_h264_chunks
        async for chunk in stream_h264_chunks(device, options):
            count += 1
            if count <= 3:
                print(f"[scrcpy] chunk {count}: {len(chunk)} bytes, first 8: {chunk[:8].hex()}")
            await websocket.send_bytes(chunk)
        print(f"[scrcpy] stream ended after {count} chunks")
    except WebSocketDisconnect:
        print("[scrcpy] client disconnected")
        return
    except Exception as exc:
        print(f"[scrcpy] ERROR: {type(exc).__name__}: {exc}")
        await websocket.close(code=1011, reason=str(exc)[:120])
