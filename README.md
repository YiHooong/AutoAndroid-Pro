# AutoAndroid WebUI

ADB WebUI with a scrcpy-based realtime display stream. The backend starts the
scrcpy server on the Android device, forwards its raw H.264 stream, remuxes it
with ffmpeg into fragmented MP4, and sends it to the browser over WebSocket.

## Run with Docker

Start adb on the host and make sure the device is authorized:

```bash
adb devices
```

Then run:

```bash
docker compose up --build
```

Open:

```text
http://localhost:8000
```

The compose file uses `network_mode: host` so the container can use the host ADB
server and forwarded scrcpy sockets without extra port wiring.

## Local Run

Install `adb`, `scrcpy`, and `ffmpeg`, then:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

## Agent Hook Plan

The current control API is intentionally close to a future Agent action schema:

- `POST /api/devices/{serial}/tap`
- `POST /api/devices/{serial}/swipe`
- `POST /api/devices/{serial}/text`
- `POST /api/devices/{serial}/keyevent`

Later, add a separate Agent observation loop using `adb exec-out screencap -p`
or UIAutomator/OCR without coupling it to the realtime scrcpy stream.
