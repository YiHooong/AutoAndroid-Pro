from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass


ADB_BIN = os.getenv("ADB_BIN", "adb")


class AdbError(RuntimeError):
    pass


@dataclass(frozen=True)
class Device:
    serial: str
    state: str
    model: str | None = None
    product: str | None = None
    transport_id: str | None = None


def run_adb(args: list[str], serial: str | None = None, timeout: float = 15) -> str:
    cmd = [ADB_BIN]
    if serial:
        cmd += ["-s", serial]
    cmd += args
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        detail = proc.stderr.strip() or proc.stdout.strip()
        raise AdbError(detail or f"adb failed: {' '.join(cmd)}")
    return proc.stdout


def list_devices() -> list[Device]:
    output = run_adb(["devices", "-l"])
    devices: list[Device] = []
    for line in output.splitlines()[1:]:
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        serial = parts[0]
        state = parts[1] if len(parts) > 1 else "unknown"
        attrs = dict(
            token.split(":", 1)
            for token in parts[2:]
            if ":" in token
        )
        devices.append(
            Device(
                serial=serial,
                state=state,
                model=attrs.get("model"),
                product=attrs.get("product"),
                transport_id=attrs.get("transport_id"),
            )
        )
    return devices


def require_device(serial: str | None = None) -> str:
    devices = [device for device in list_devices() if device.state == "device"]
    if serial:
        if not any(device.serial == serial for device in devices):
            raise AdbError(f"device not connected or unauthorized: {serial}")
        return serial
    if not devices:
        raise AdbError("no authorized adb devices")
    return devices[0].serial


def shell(serial: str, command: str, timeout: float = 15) -> str:
    return run_adb(["shell", command], serial=serial, timeout=timeout)


def tap(serial: str, x: int, y: int) -> None:
    shell(serial, f"input tap {x} {y}")


def swipe(serial: str, x1: int, y1: int, x2: int, y2: int, duration_ms: int) -> None:
    shell(serial, f"input swipe {x1} {y1} {x2} {y2} {max(1, duration_ms)}")


def keyevent(serial: str, key: str | int) -> None:
    shell(serial, f"input keyevent {key}")


def input_text(serial: str, text: str) -> None:
    # Android input text uses %s for spaces and needs shell-sensitive chars escaped.
    encoded = text.replace("%", "%25").replace(" ", "%s")
    encoded = re.sub(r"([&|;<>()$`\"'\\\\])", r"\\\1", encoded)
    shell(serial, f"input text {encoded}")


def connect(address: str) -> str:
    """Run `adb connect <address>`.  Returns the raw output line."""
    return run_adb(["connect", address], timeout=10).strip()


def pair(address: str, code: str) -> str:
    """Run `adb pair <address> <code>` (Android 11+ wireless debugging)."""
    return run_adb(["pair", address, code], timeout=15).strip()
