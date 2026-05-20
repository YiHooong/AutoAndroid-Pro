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
        self.socket_name = (
            f"autoandroid_{uuid.uuid4().hex[:10]}" if self.major >= 2 else "scrcpy"
        )
        self.port = _free_port()
        self.server_proc: subprocess.Popen[bytes] | None = None
        self.ffmpeg_proc: asyncio.subprocess.Process | None = None

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
        option_pairs = [
            "log_level=info",
            "tunnel_forward=true",
            "control=false",
            "cleanup=true",
            "send_device_meta=false",
            _raw_stream_option(self.version),
            f"max_size={self.options.max_size}",
        ]
        if self.options.max_fps > 0:
            option_pairs.append(f"max_fps={self.options.max_fps}")

        if self.major >= 2:
            option_pairs += [
                f"socket_name={self.socket_name}",
                "audio=false",
                "send_codec_meta=false",
                f"video_bit_rate={bit_rate}",
            ]
        else:
            option_pairs += [
                "send_frame_meta=false",
                f"bit_rate={bit_rate}",
            ]
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
        We therefore retry on *both* connection errors and early-EOF.
        """
        last_error: Exception | None = None
        for _ in range(50):
            reader: asyncio.StreamReader | None = None
            writer: asyncio.StreamWriter | None = None
            try:
                reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
                sock = writer.get_extra_info("socket")
                if sock:
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                # Peek: the scrcpy server always sends at least 1 byte (dummy
                # byte) immediately after accepting.  If we get nothing within
                # a reasonable window the connection was forwarded to nowhere.
                first = await asyncio.wait_for(reader.read(1), timeout=5.0)
                if not first:
                    raise ConnectionError("EOF immediately after connect")
                # Prepend the byte we consumed back into the reader buffer.
                reader._buffer = bytearray(first) + reader._buffer  # noqa: SLF001
                return reader, writer
            except (OSError, ConnectionError, asyncio.TimeoutError) as exc:
                last_error = exc
                if writer:
                    writer.close()
                    with contextlib.suppress(Exception):
                        await writer.wait_closed()
                await asyncio.sleep(0.2)
        raise ConnectionError(f"scrcpy video socket not available: {last_error}")

    async def close(self) -> None:
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

        # scrcpy 1.x sends metadata before the H.264 stream:
        #   - 1 dummy byte (0x00)
        #   - 64-byte device name + 4-byte screen dims (if send_device_meta)
        # Skip past these bytes; stream from the first NAL start code.
        NAL_START = b"\x00\x00\x00\x01"
        buf = b""
        while True:
            data = await reader.read(64 * 1024)
            if not data:
                return
            buf += data
            idx = buf.find(NAL_START)
            if idx >= 0:
                yield buf[idx:]
                break

        while True:
            chunk = await reader.read(64 * 1024)
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
