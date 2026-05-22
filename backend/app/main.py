from __future__ import annotations

import contextlib
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import adb
from .scrcpy import StreamOptions


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


class ShellPayload(BaseModel):
    command: str


class ConnectPayload(BaseModel):
    address: str = Field(description="host:port, e.g. 192.168.1.100:5555")


class PairPayload(BaseModel):
    address: str = Field(description="host:port shown in wireless-debugging pairing dialog")
    code: str = Field(description="6-digit pairing code")

import asyncio
async def ghost_device_cleaner():
    while True:
        try:
            devices = adb.list_devices()
            for d in devices:
                if d.state == "device" and ":" in d.serial:
                    proc = await asyncio.create_subprocess_exec(
                        adb.ADB_BIN, "-s", d.serial, "shell", "echo", "1",
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL
                    )
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=3.0)
                        if proc.returncode != 0:
                            adb.run_adb(["disconnect", d.serial])
                    except asyncio.TimeoutError:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                        try:
                            adb.run_adb(["disconnect", d.serial])
                        except Exception:
                            pass
        except Exception:
            pass
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(ghost_device_cleaner())


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
@app.get("/api/devices/{serial}/screenshot")
def capture_screenshot(serial: str):
    """Capture a screenshot from the device using adb exec-out screencap -p."""
    try:
        import subprocess
        from .adb import ADB_BIN
        cmd = [ADB_BIN, "-s", serial, "exec-out", "screencap", "-p"]
        proc = subprocess.run(cmd, capture_output=True, timeout=8)
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail="Screencap failed")
        return Response(content=proc.stdout, media_type="image/png")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc



@app.post("/api/connect")
def connect_device(payload: ConnectPayload):
    try:
        message = adb.connect(payload.address)
        return {"ok": True, "message": message}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/disconnect")
def disconnect_device(payload: ConnectPayload):
    try:
        message = adb.disconnect(payload.address)
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


@app.get("/api/devices/{serial}/refresh-rate")
def get_refresh_rate(serial: str):
    try:
        output = adb.shell(serial, "dumpsys display")
        import re
        rates = []
        for match in re.finditer(r"baseModeRefreshRate=([0-9.]+)", output):
            rates.append(float(match.group(1)))
        for match in re.finditer(r"refreshRate=([0-9.]+)", output):
            rates.append(float(match.group(1)))
        for match in re.finditer(r"fps=([0-9.]+)", output):
            rates.append(float(match.group(1)))
            
        if not rates:
            return {"fps": 60}
            
        max_rate = max(rates)
        if max_rate > 130:
            return {"fps": 144}
        elif max_rate > 105:
            return {"fps": 120}
        elif max_rate > 75:
            return {"fps": 90}
        else:
            return {"fps": 60}
    except Exception as exc:
        return {"fps": 60}


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


@app.post("/api/devices/{serial}/shell")
def run_device_shell(serial: str, payload: ShellPayload):
    try:
        cmd_str = payload.command.strip()
        # 1. If it starts with "adb shell ", strip it and run as a shell command
        if cmd_str.startswith("adb shell "):
            sub_cmd = cmd_str[10:].strip()
            output = adb.shell(serial, sub_cmd)
        # 2. If it starts with other "adb " command, strip and run as general adb command
        elif cmd_str.startswith("adb "):
            import shlex
            parts = shlex.split(cmd_str[4:].strip())
            # Inject serial if not manually specified in the adb arguments
            if "-s" not in parts:
                output = adb.run_adb(parts, serial=serial)
            else:
                output = adb.run_adb(parts)
        # 3. Default to running it as a shell command directly on the device
        else:
            output = adb.shell(serial, cmd_str)
            
        return {"ok": True, "output": output}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class AiTestPayload(BaseModel):
    provider: str
    endpoint: str
    api_key: str
    model_name: str
    anthropic_version: str | None = None


@app.post("/api/ai/test")
def test_ai_connection(payload: AiTestPayload):
    import json
    import urllib.request
    import urllib.error

    provider = payload.provider.lower()
    endpoint = payload.endpoint.strip()
    api_key = payload.api_key.strip()
    model_name = payload.model_name.strip()
    
    # 1. Format the endpoint
    if provider == "openai":
        if not (endpoint.endswith("/chat/completions") or endpoint.endswith("/chat/completions/")):
            endpoint = endpoint.rstrip("/")
            if not endpoint.endswith("/v1"):
                endpoint = f"{endpoint}/v1"
            endpoint = f"{endpoint}/chat/completions"
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "AutoAndroidPro/1.0"
        }
        body = {
            "model": model_name,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 10
        }
    else:  # anthropic
        if not (endpoint.endswith("/messages") or endpoint.endswith("/messages/")):
            endpoint = endpoint.rstrip("/")
            if not endpoint.endswith("/v1"):
                endpoint = f"{endpoint}/v1"
            endpoint = f"{endpoint}/messages"
            
        version = payload.anthropic_version or "2023-06-01"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": version,
            "Content-Type": "application/json",
            "User-Agent": "AutoAndroidPro/1.0"
        }
        body = {
            "model": model_name,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 10
        }
        
    # 2. Perform request
    try:
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        
        # Add a timeout of 12 seconds to avoid hanging
        with urllib.request.urlopen(req, timeout=12) as response:
            resp_body = response.read().decode("utf-8")
            resp_json = json.loads(resp_body)
            
            message_text = "Connection test succeeded!"
            if provider == "openai":
                if "choices" in resp_json and len(resp_json["choices"]) > 0:
                    msg = resp_json["choices"][0].get("message", {})
                    message_text = msg.get("content", "Success!")
            else:  # anthropic
                if "content" in resp_json and len(resp_json["content"]) > 0:
                    message_text = resp_json["content"][0].get("text", "Success!")
                    
            return {"ok": True, "message": message_text, "raw": resp_json}
            
    except urllib.error.HTTPError as err:
        try:
            err_body = err.read().decode("utf-8")
            err_json = json.loads(err_body)
        except Exception:
            err_json = err_body if 'err_body' in locals() else str(err)
        return {"ok": False, "error": f"HTTP Error {err.code}: {err.reason}", "detail": err_json}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.websocket("/ws/scrcpy")
async def scrcpy_ws(
    websocket: WebSocket,
    serial: str | None = Query(default=None),
    max_size: int = Query(default=1280, ge=320, le=4096),
    max_fps: int = Query(default=60, ge=0),
    bit_rate: str = Query(default="8M"),
    chunk_size: int = Query(default=4096, ge=0),
    audio: bool = Query(default=False),
):
    await websocket.accept()
    try:
        device = adb.require_device(serial)
        options = StreamOptions(
            max_size=max_size,
            max_fps=max_fps,
            video_bit_rate=bit_rate,
            chunk_size=chunk_size,
            audio=audio,
        )
        from .scrcpy import get_broadcaster, send_touch_control
        broadcaster = await get_broadcaster(device)
        await broadcaster.subscribe(websocket, options)
        try:
            while True:
                # Receive binary control messages (touch events) from the browser
                data = await websocket.receive_bytes()
                if data and len(data) > 0:
                    await send_touch_control(device, data)
        except WebSocketDisconnect:
            pass
        finally:
            await broadcaster.unsubscribe(websocket)
    except Exception as exc:
        print(f"[scrcpy] ERROR: {type(exc).__name__}: {exc}")
        with contextlib.suppress(Exception):
            await websocket.close(code=1011, reason=str(exc)[:120])


@app.websocket("/ws/audio")
async def audio_ws(websocket: WebSocket, serial: str | None = Query(default=None)):
    """Stream raw real-time PCM audio bytes directly over WebSocket for ultra-low latency playback."""
    await websocket.accept()
    try:
        from .scrcpy import stream_audio_pcm, ACTIVE_SESSIONS
        # Wait for the session and its audio queue to be fully connected
        for _ in range(60):
            session = ACTIVE_SESSIONS.get(serial)
            if session and session.audio_queue:
                break
            await asyncio.sleep(0.1)
        else:
            print(f"[scrcpy audio ws] Timeout waiting for session/audio_queue for {serial}")
            await websocket.close(code=1011, reason="Session not active")
            return

        async for chunk in stream_audio_pcm(serial):
            await websocket.send_bytes(chunk)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[scrcpy audio ws] ERROR: {exc}")
        with contextlib.suppress(Exception):
            await websocket.close(code=1011, reason=str(exc)[:120])


@app.get("/api/devices/{serial}/audio")
async def get_audio_stream(serial: str):
    """Serve a transcoded real-time MP3 audio stream for standard browser playing."""
    from .scrcpy import stream_audio_pcm, ACTIVE_SESSIONS
    
    # Wait for the session and its audio queue to be fully connected
    for _ in range(60):
        session = ACTIVE_SESSIONS.get(serial)
        if session and session.audio_queue:
            break
        await asyncio.sleep(0.1)
    else:
        print(f"[scrcpy audio] Timeout waiting for session/audio_queue for {serial}")
        return StreamingResponse(iter([]), media_type="audio/mpeg")

    # We transcode the raw s16le PCM (48000Hz, stereo) stream into MP3
    cmd = [
        "ffmpeg",
        "-hide_banner", "-loglevel", "warning",
        "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0",
        "-c:a", "libmp3lame", "-q:a", "4",
        "-f", "mp3",
        "pipe:1"
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    async def feed_pcm():
        try:
            async for chunk in stream_audio_pcm(serial):
                if proc.stdin and not proc.stdin.is_closing():
                    proc.stdin.write(chunk)
                    await proc.stdin.drain()
        except Exception:
            pass
        finally:
            if proc.stdin:
                with contextlib.suppress(Exception):
                    proc.stdin.close()
                    await proc.stdin.wait_closed()
                
    asyncio.create_task(feed_pcm())
    
    async def stream_output():
        try:
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                yield chunk
        finally:
            if proc.returncode is None:
                proc.terminate()
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(proc.wait(), timeout=1)

    return StreamingResponse(stream_output(), media_type="audio/mpeg")
