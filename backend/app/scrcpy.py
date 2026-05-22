from __future__ import annotations

import asyncio
import contextlib
import os
import re
import shutil
import socket
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from .adb import ADB_BIN, AdbError, run_adb


SCRCPY_BIN = os.getenv("SCRCPY_BIN", "scrcpy")
SCRCPY_SERVER_PATH = os.getenv("SCRCPY_SERVER_PATH")
DEVICE_SERVER_PATH = "/data/local/tmp/autoandroid-scrcpy-server.jar"


def _scrcpy_version() -> str:
    configured = os.getenv("SCRCPY_VERSION")
    if configured:
        return configured
    try:
        proc = subprocess.run(
            [SCRCPY_BIN, "--version"],
            text=True,
            capture_output=True,
            timeout=5,
        )
        match = re.search(r"scrcpy\s+([0-9][^\s]*)", proc.stdout + proc.stderr)
        if match:
            return match.group(1)
    except Exception:
        pass
    return "3.1"


def _server_path() -> Path:
    candidates = [
        SCRCPY_SERVER_PATH,
        "/usr/share/scrcpy/scrcpy-server-v4.0",
        "/usr/share/scrcpy/scrcpy-server",
        "/usr/share/scrcpy/scrcpy-server.jar",
        "/usr/local/share/scrcpy/scrcpy-server",
        "/opt/scrcpy/scrcpy-server.jar",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    raise FileNotFoundError(
        "scrcpy server not found; set SCRCPY_SERVER_PATH or install scrcpy"
    )


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _raw_stream_option(version: str) -> str:
    major = int(version.split(".", 1)[0]) if version[:1].isdigit() else 3
    return "raw_stream=true" if major >= 2 else "raw_video_stream=true"


def _major(version: str) -> int:
    return int(version.split(".", 1)[0]) if version[:1].isdigit() else 3


def _bit_rate_value(value: str) -> str:
    text = value.strip().upper()
    multiplier = 1
    if text.endswith("M"):
        multiplier = 1_000_000
        text = text[:-1]
    elif text.endswith("K"):
        multiplier = 1_000
        text = text[:-1]
    try:
        return str(int(float(text) * multiplier))
    except ValueError:
        return value


@dataclass
class StreamOptions:
    max_size: int = 1280
    max_fps: int = 60
    video_bit_rate: str = "8M"


class ScrcpySession:
    def __init__(self, serial: str, options: StreamOptions) -> None:
        self.serial = serial
        self.options = options
        self.version = _scrcpy_version()
        self.major = _major(self.version)
        if self.major >= 4:
            # v4 uses scid (31-bit non-negative int) for unique socket naming
            scid_val = int(uuid.uuid4().hex[:7], 16) % (2**30)
            self.scid = scid_val
            self.socket_name = f"scrcpy_{scid_val:08x}"
        elif self.major >= 2:
            self.socket_name = f"autoandroid_{uuid.uuid4().hex[:10]}"
            self.scid = None
        else:
            self.socket_name = "scrcpy"
            self.scid = None
        self.port = _free_port()
        self.server_proc: subprocess.Popen[bytes] | None = None
        self.ffmpeg_proc: asyncio.subprocess.Process | None = None
        self.control_writer: asyncio.StreamWriter | None = None

    def _adb_prefix(self) -> list[str]:
        return [ADB_BIN, "-s", self.serial]

    def prepare(self) -> None:
        server = _server_path()
        run_adb(["push", str(server), DEVICE_SERVER_PATH], serial=self.serial, timeout=30)
        run_adb(
            ["forward", f"tcp:{self.port}", f"localabstract:{self.socket_name}"],
            serial=self.serial,
        )

    def start_server(self) -> None:
        with contextlib.suppress(Exception):
            kill_cmd = (
                "ps -A | grep -E 'shell.*app_process' | "
                "while read -r user pid rest; do kill -9 $pid; done; sleep 0.5"
            )
            run_adb(["shell", kill_cmd], serial=self.serial)
        bit_rate = _bit_rate_value(self.options.video_bit_rate)
        if self.major >= 4:
            option_pairs = [
                "log_level=info",
                "tunnel_forward=true",
                "control=true",
                "cleanup=true",
                "video=true",
                "audio=false",
                "raw_stream=true",
                f"max_size={self.options.max_size}",
                f"video_bit_rate={bit_rate}",
            ]
            if self.options.max_fps > 0:
                option_pairs.append(f"max_fps={self.options.max_fps}")
            if self.scid is not None:
                option_pairs.append(f"scid={self.scid:x}")
            option_pairs.append("video_codec_options=i-frame-interval=1")
        elif self.major >= 2:
            option_pairs = [
                "log_level=info",
                "tunnel_forward=true",
                "control=true",
                "cleanup=true",
                "send_device_meta=false",
                _raw_stream_option(self.version),
                f"max_size={self.options.max_size}",
                f"socket_name={self.socket_name}",
                "audio=false",
                "send_codec_meta=false",
                f"video_bit_rate={bit_rate}",
                "video_codec_options=i-frame-interval=1",
            ]
            if self.options.max_fps > 0:
                option_pairs.append(f"max_fps={self.options.max_fps}")
        else:
            option_pairs = [
                "log_level=info",
                "tunnel_forward=true",
                "control=true",
                "cleanup=true",
                "send_device_meta=false",
                _raw_stream_option(self.version),
                f"max_size={self.options.max_size}",
                "send_frame_meta=false",
                f"bit_rate={bit_rate}",
                "codec_options=i-frame-interval=1",
            ]
            if self.options.max_fps > 0:
                option_pairs.append(f"max_fps={self.options.max_fps}")

        command = (
            f"CLASSPATH={DEVICE_SERVER_PATH} app_process / "
            f"com.genymobile.scrcpy.Server {self.version} {' '.join(option_pairs)}"
        )
        self.server_proc = subprocess.Popen(
            self._adb_prefix() + ["shell", command],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    async def start_ffmpeg(self) -> asyncio.subprocess.Process:
        if not shutil.which("ffmpeg"):
            raise FileNotFoundError("ffmpeg not found")
        url = f"tcp://127.0.0.1:{self.port}?timeout=5000000"
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-fflags",
            "nobuffer",
            "-flags",
            "low_delay",
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
            "-f",
            "h264",
            "-i",
            url,
            "-c:v",
            "copy",
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ]
        self.ffmpeg_proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        return self.ffmpeg_proc

    async def connect_video_socket(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        """Connect to the scrcpy video socket with retry.

        When ``adb forward`` is active, the TCP port is reachable immediately
        (ADB daemon listens on it).  But if the scrcpy server hasn't created
        its abstract socket yet, ADB accepts the TCP connection and then
        closes it — yielding an immediate EOF rather than an ``OSError``.

        With control=true, scrcpy won't send any data on the video socket
        until the control socket is also connected.  So we just verify the
        connection is alive (no immediate EOF) with a short wait, then return.
        """
        last_error: Exception | None = None
        for attempt in range(50):
            reader: asyncio.StreamReader | None = None
            writer: asyncio.StreamWriter | None = None
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
                sock = writer.get_extra_info("socket")
                if sock:
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                # With control=true, the server won't send data until the control
                # socket is also connected. We do a brief wait to catch immediate
                # EOF (which means the forwarded socket was rejected).
                try:
                    first = await asyncio.wait_for(reader.read(1), timeout=0.5)
                    if not first:
                        raise ConnectionError("EOF immediately after connect")
                    # Prepend the byte we consumed back into the reader buffer.
                    reader._buffer = bytearray(first) + reader._buffer  # noqa: SLF001
                except asyncio.TimeoutError:
                    # Timeout is OK — server is waiting for the control socket
                    pass
                return reader, writer
            except (OSError, ConnectionError) as exc:
                last_error = exc
                if writer:
                    writer.close()
                    with contextlib.suppress(Exception):
                        await writer.wait_closed()
                await asyncio.sleep(0.2)
        raise ConnectionError(f"scrcpy video socket not available: {last_error}")

    async def connect_control_socket(self) -> asyncio.StreamWriter:
        """Connect to the scrcpy control socket (second connection after video).

        With control=true and tunnel_forward=true, scrcpy server accepts
        two connections on the same port: first is video, second is control.
        """
        last_error: Exception | None = None
        for _ in range(30):
            writer: asyncio.StreamWriter | None = None
            try:
                _, writer = await asyncio.open_connection("127.0.0.1", self.port)
                sock = writer.get_extra_info("socket")
                if sock:
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                self.control_writer = writer
                return writer
            except (OSError, ConnectionError) as exc:
                last_error = exc
                if writer:
                    writer.close()
                    with contextlib.suppress(Exception):
                        await writer.wait_closed()
                await asyncio.sleep(0.1)
        raise ConnectionError(f"scrcpy control socket not available: {last_error}")

    async def send_control(self, data: bytes) -> None:
        """Send a binary control message to scrcpy server."""
        if self.control_writer and not self.control_writer.is_closing():
            self.control_writer.write(data)
            await self.control_writer.drain()

    async def close(self) -> None:
        if self.control_writer:
            self.control_writer.close()
            with contextlib.suppress(Exception):
                await self.control_writer.wait_closed()
            self.control_writer = None
        with contextlib.suppress(Exception):
            run_adb(["forward", "--remove", f"tcp:{self.port}"], serial=self.serial)
        if self.ffmpeg_proc and self.ffmpeg_proc.returncode is None:
            self.ffmpeg_proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.ffmpeg_proc.wait(), timeout=2)
        if self.server_proc and self.server_proc.poll() is None:
            self.server_proc.terminate()
            with contextlib.suppress(Exception):
                self.server_proc.wait(timeout=2)


async def stream_mp4_chunks(serial: str, options: StreamOptions):
    cmd = [
        "ffmpeg",
        "-hide_banner", "-loglevel", "warning",
        "-f", "h264", "-i", "pipe:0",
        "-c:v", "copy",
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    assert proc.stdin is not None
    assert proc.stdout is not None
    assert proc.stderr is not None

    async def feed_ffmpeg():
        try:
            async for chunk in stream_h264_chunks(serial, options):
                proc.stdin.write(chunk)
                await proc.stdin.drain()
        except Exception as e:
            print(f"feed_ffmpeg exception: {e}")
            pass
        finally:
            proc.stdin.close()

    feed_task = asyncio.create_task(feed_ffmpeg())

    try:
        while True:
            chunk = await proc.stdout.read(64 * 1024)
            if not chunk:
                err = await proc.stderr.read()
                print(f"ffmpeg stream ended! stderr: {err.decode('utf-8', 'ignore')}")
                break
            yield chunk
    finally:
        feed_task.cancel()
        if proc.returncode is None:
            proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=2)


ACTIVE_SESSIONS: dict[str, ScrcpySession] = {}
SESSION_LOCKS: dict[str, asyncio.Lock] = {}


from fastapi import WebSocket

class DeviceStreamBroadcaster:
    def __init__(self, serial: str) -> None:
        self.serial = serial
        self.subscribers: set[WebSocket] = set()
        self.read_task: asyncio.Task | None = None
        self.cached_header: bytes | None = None
        self.lock = asyncio.Lock()

    async def subscribe(self, websocket: WebSocket, options: StreamOptions) -> None:
        async with self.lock:
            if self.cached_header:
                await websocket.send_bytes(self.cached_header)
            
            self.subscribers.add(websocket)
            
            if self.read_task is None:
                self.read_task = asyncio.create_task(self._read_loop(options))

    async def unsubscribe(self, websocket: WebSocket) -> None:
        async with self.lock:
            self.subscribers.discard(websocket)
            if not self.subscribers and self.read_task:
                self.read_task.cancel()
                self.read_task = None
                self.cached_header = None

    async def _read_loop(self, options: StreamOptions) -> None:
        try:
            async for chunk in stream_h264_chunks(self.serial, options):
                if self.cached_header is None:
                    self.cached_header = chunk
                await self._broadcast(chunk)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[Broadcaster {self.serial}] Error in read loop: {e}")
        finally:
            async with self.lock:
                self.read_task = None
                self.cached_header = None
                # Close all subscriber sockets to signal the stream ended
                for ws in list(self.subscribers):
                    try:
                        await ws.close(code=1011, reason="Stream source disconnected")
                    except Exception:
                        pass
                self.subscribers.clear()

    async def _broadcast(self, chunk: bytes) -> None:
        async def safe_send(ws: WebSocket):
            try:
                await ws.send_bytes(chunk)
            except Exception:
                await self.unsubscribe(ws)

        if self.subscribers:
            await asyncio.gather(*(safe_send(ws) for ws in list(self.subscribers)), return_exceptions=True)


BROADCASTERS: dict[str, DeviceStreamBroadcaster] = {}
BROADCASTERS_LOCK = asyncio.Lock()


async def get_broadcaster(serial: str) -> DeviceStreamBroadcaster:
    async with BROADCASTERS_LOCK:
        if serial not in BROADCASTERS:
            BROADCASTERS[serial] = DeviceStreamBroadcaster(serial)
        return BROADCASTERS[serial]


async def send_touch_control(serial: str, data: bytes) -> None:
    """Forward a binary scrcpy control message to the active session."""
    session = ACTIVE_SESSIONS.get(serial)
    if session:
        await session.send_control(data)


async def stream_h264_chunks(serial: str, options: StreamOptions):
    if serial not in SESSION_LOCKS:
        SESSION_LOCKS[serial] = asyncio.Lock()

    session = None
    writer: asyncio.StreamWriter | None = None
    try:
        async with SESSION_LOCKS[serial]:
            if serial in ACTIVE_SESSIONS:
                old_session = ACTIVE_SESSIONS[serial]
                print(f"[scrcpy] closing active session for {serial} to prevent conflict")
                with contextlib.suppress(Exception):
                    await old_session.close()
                ACTIVE_SESSIONS.pop(serial, None)
                await asyncio.sleep(0.5)

            session = ScrcpySession(serial, options)
            ACTIVE_SESSIONS[serial] = session
            session.prepare()
            session.start_server()
            try:
                reader, writer = await session.connect_video_socket()
            except ConnectionError as e:
                if session.server_proc and session.server_proc.stderr:
                    err = session.server_proc.stderr.read().decode('utf-8', 'ignore')
                    print(f"[scrcpy-server error]: {err}")
                raise e

            # Connect the control socket (second connection with control=true)
            try:
                await session.connect_control_socket()
                print(f"[scrcpy] control socket connected for {serial}")
            except ConnectionError as e:
                print(f"[scrcpy] WARNING: control socket failed: {e} — touch input will fall back to adb")

        # scrcpy 1.x sends metadata before the H.264 stream:
        #   - 1 dummy byte (0x00)
        #   - 64-byte device name + 4-byte screen dims (if send_device_meta)
        # Skip past these bytes; stream from the first NAL start code.
        NAL_START = b"\x00\x00\x00\x01"
        buf = b""
        while True:
            data = await reader.read(4096)
            if not data:
                return
            buf += data
            idx = buf.find(NAL_START)
            if idx >= 0:
                yield buf[idx:]
                break

        while True:
            chunk = await reader.read(4096)
            if not chunk:
                break
            yield chunk
    finally:
        ACTIVE_SESSIONS.pop(serial, None)
        if writer:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
        if session:
            await session.close()
