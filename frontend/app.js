const state = {
  devices: [],
  selected: "",
  ws: null,
  // WebCodecs engine
  decoder: null,
  parser: null,
  videoWidth: 0,
  videoHeight: 0,
  // Interaction
  dragStart: null,
  // FPS Tracking
  frameCount: 0,
  lastFpsTime: 0,
  fpsIntervalId: null,
  smoothedFps: 0,
};

const $ = (id) => document.getElementById(id);
const video = $("phoneVideo");
const canvas = $("phoneCanvas");
const ctx = canvas.getContext("2d");
const emptyState = $("emptyState");

const MAX_LOG_ENTRIES = 200;

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  const container = $("logs");
  container.insertBefore(item, container.firstChild);
  // Prevent unbounded DOM growth
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.removeChild(container.lastChild);
  }
}

function setStatus(text, detail = "") {
  $("statusText").textContent = text;
  $("statusDetail").textContent = detail;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = typeof body.detail === "object" ? JSON.stringify(body.detail) : (body.detail || response.statusText);
    throw new Error(msg);
  }
  return response.json();
}

async function updateDeviceResolution() {
  const serial = $("deviceSelect").value;
  if (!serial) return;
  try {
    const res = await api(`/api/devices/${encodeURIComponent(serial)}/wm-size`);
    const match = res.raw.match(/(\d+)x(\d+)/);
    if (match) {
      const w = parseInt(match[1]);
      const h = parseInt(match[2]);
      const maxDim = Math.min(1920, Math.max(w, h));
      $("maxSize").value = maxDim;
      log(`Device resolution loaded: ${w}x${h} (Capped: ${maxDim}px)`);
    } else {
      $("maxSize").value = "1280";
    }
  } catch (err) {
    log(`Failed to fetch device resolution: ${err.message}`);
    $("maxSize").value = "1280";
  }

  try {
    const fpsRes = await api(`/api/devices/${encodeURIComponent(serial)}/refresh-rate`);
    $("maxFps").value = fpsRes.fps;
    log(`Device refresh rate loaded: ${fpsRes.fps} Hz`);
  } catch (err) {
    log(`Failed to fetch device refresh rate: ${err.message}`);
    $("maxFps").value = "";
  }
}

async function loadDevices() {
  const data = await api("/api/devices");
  state.devices = data.devices || [];
  const select = $("deviceSelect");
  select.innerHTML = "";
  for (const device of state.devices) {
    const option = document.createElement("option");
    option.value = device.serial;
    option.textContent = `${device.serial} · ${device.state}${device.model ? ` · ${device.model}` : ""}`;
    select.appendChild(option);
  }
  if (state.devices.length) {
    state.selected = select.value || state.devices[0].serial;
    const current = state.devices.find((device) => device.serial === state.selected);
    $("deviceMeta").textContent = current?.product || current?.model || current?.state || "device";
    await updateDeviceResolution();
  } else {
    $("deviceMeta").textContent = "No authorized devices found";
  }
}

// ═══════════════════════════════════════════════════════
// AnnexB NAL Parser — pre-allocated buffer to avoid
// per-frame memory allocation and GC pressure
// ═══════════════════════════════════════════════════════
class AnnexBParser {
  constructor(onNal) {
    this.onNal = onNal;
    this.buffer = new Uint8Array(512 * 1024); // Pre-allocate 512KB
    this.length = 0;
  }

  append(data) {
    // Grow only when needed (doubling strategy)
    if (this.length + data.length > this.buffer.length) {
      const newSize = Math.max(this.buffer.length * 2, this.length + data.length);
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buffer.subarray(0, this.length), 0);
      this.buffer = newBuf;
    }
    this.buffer.set(data, this.length);
    this.length += data.length;

    let offset = 0;
    while (true) {
      const nextStart = this.findStartCode(offset + 4);
      if (nextStart === -1) {
        // Move unconsumed data to the front
        if (offset > 0) {
          this.buffer.copyWithin(0, offset, this.length);
          this.length -= offset;
        }
        break;
      }
      this.onNal(this.buffer.slice(offset, nextStart));
      offset = nextStart;
    }
  }

  findStartCode(start) {
    const buf = this.buffer;
    const len = this.length - 4;
    for (let i = start; i <= len; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0) {
        if (buf[i + 2] === 1) return i;
        if (buf[i + 2] === 0 && buf[i + 3] === 1) return i;
      }
    }
    return -1;
  }
}

// ═══════════════════════════════════════════════════════
// FPS Counter
// ═══════════════════════════════════════════════════════
function startFpsCounter() {
  stopFpsCounter();

  const fpsCounter = $("fpsCounter");
  fpsCounter.style.display = "inline-flex";
  fpsCounter.textContent = "0 FPS";

  state.frameCount = 0;
  state.lastFpsTime = performance.now();
  state.smoothedFps = 0;

  state.fpsIntervalId = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - state.lastFpsTime;
    if (elapsedMs <= 0) return;

    const currentFrames = state.frameCount;
    state.frameCount = 0;

    const fps = Math.round((currentFrames * 1000) / elapsedMs);
    const alpha = 0.3;
    state.smoothedFps = state.smoothedFps ? Math.round(state.smoothedFps * (1 - alpha) + fps * alpha) : fps;
    fpsCounter.textContent = `${state.smoothedFps} FPS`;
    state.lastFpsTime = now;
  }, 1000);
}

function stopFpsCounter() {
  if (state.fpsIntervalId) {
    clearInterval(state.fpsIntervalId);
    state.fpsIntervalId = null;
  }
  $("fpsCounter").style.display = "none";
}

// ═══════════════════════════════════════════════════════
// Stream lifecycle
// ═══════════════════════════════════════════════════════
function resetStream() {
  stopFpsCounter();
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }

  if (state.decoder) {
    try {
      state.decoder.close();
    } catch (e) {}
    state.decoder = null;
  }
  state.parser = null;
  state.videoWidth = 0;
  state.videoHeight = 0;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.display = "none";
  canvas.classList.remove("active");

  video.removeAttribute("src");
  video.load();
  video.style.display = "none";

  emptyState.style.display = "block";

  const btn = $("connectBtn");
  btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M5.268 5.268c3.272-3.272 8.573-3.272 11.845 0m-9.016 2.828c1.71-1.71 4.48-1.71 6.19 0m-3.896 2.115a2.5 2.5 0 100 5m0-5a2.5 2.5 0 110 5"></path></svg> Start Stream`;
  btn.disabled = false;
  btn.classList.remove("streaming-active");
}

function connectStream() {
  const btn = $("connectBtn");
  if (state.ws) {
    resetStream();
    return;
  }

  const serial = $("deviceSelect").value;
  if (!serial) {
    setStatus("No device", "ADB is empty or has no selected device");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:4px;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M4 12a8 8 0 0 1 8-8" stroke-linecap="round"></path></svg> Connecting...`;

  const bitRate = ($("bitRateValue").value || "8") + $("bitRateUnit").value;
  const params = new URLSearchParams({
    serial,
    max_size: $("maxSize").value || "1280",
    max_fps: $("maxFps").value || "0",
    bit_rate: bitRate,
  });

  // Setup WebCodecs + Canvas
  log("Engine: WebCodecs + Canvas (Hardware Acceleration)");
  canvas.style.display = "block";
  canvas.classList.add("active");
  video.style.display = "none";

  state.decoder = new VideoDecoder({
    output(frame) {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
        state.videoWidth = frame.displayWidth;
        state.videoHeight = frame.displayHeight;
      }
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
      state.frameCount++;
    },
    error(e) {
      log(`Decoder error: ${e.message}`);
      console.error("WebCodecs error:", e);
    },
  });

  state.decoder.configure({
    codec: "avc1.42e01f",
    optimizeForLatency: true,
  });

  let hasSeenKeyFrame = false;
  let pendingSps = null;
  let pendingPps = null;

  state.parser = new AnnexBParser((nal) => {
    try {
      let offset = 0;
      if (nal[0] === 0 && nal[1] === 0) {
        if (nal[2] === 1) offset = 3;
        else if (nal[2] === 0 && nal[3] === 1) offset = 4;
      }
      const nalType = nal[offset] & 0x1f;

      if (nalType === 7) { // SPS
        pendingSps = nal;
        return;
      }
      if (nalType === 8) { // PPS
        pendingPps = nal;
        return;
      }

      if (nalType === 5) { // IDR / Key Frame — stitch SPS+PPS+IDR
        let combined = nal;
        if (pendingSps && pendingPps) {
          combined = new Uint8Array(pendingSps.length + pendingPps.length + nal.length);
          combined.set(pendingSps, 0);
          combined.set(pendingPps, pendingSps.length);
          combined.set(nal, pendingSps.length + pendingPps.length);
        }
        state.decoder?.decode(new EncodedVideoChunk({
          type: "key",
          timestamp: performance.now() * 1000,
          data: combined,
        }));
        hasSeenKeyFrame = true;
      } else if (nalType === 1 && hasSeenKeyFrame) { // Delta Frame
        state.decoder?.decode(new EncodedVideoChunk({
          type: "delta",
          timestamp: performance.now() * 1000,
          data: nal,
        }));
      }
    } catch (err) {
      console.error("Frame decoding error:", err);
    }
  });

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws/scrcpy?${params}`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  ws.onopen = () => {
    setStatus("Streaming", serial);
    emptyState.style.display = "none";
    log(`stream connected: ${serial}`);
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg> Stop Stream`;
    btn.classList.add("streaming-active");
    startFpsCounter();
  };

  ws.onmessage = (event) => {
    if (state.parser) {
      state.parser.append(new Uint8Array(event.data));
    }
  };

  ws.onerror = () => {
    setStatus("Stream error", "Check backend scrcpy logs");
    log("stream error");
    resetStream();
  };

  ws.onclose = (event) => {
    setStatus("Disconnected", event.reason || "stream closed");
    log(`stream closed${event.reason ? `: ${event.reason}` : ""}`);
    resetStream();
  };
}

// ═══════════════════════════════════════════════════════
// Pointer / touch interaction
// ═══════════════════════════════════════════════════════
function activePoint(event) {
  const rect = canvas.getBoundingClientRect();
  const width = state.videoWidth;
  const height = state.videoHeight;
  if (!width) return { x: 0, y: 0 };
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  return {
    x: Math.max(0, Math.round((event.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.round((event.clientY - rect.top) * scaleY)),
  };
}

async function sendTap(point) {
  const serial = $("deviceSelect").value;
  await api(`/api/devices/${encodeURIComponent(serial)}/tap`, {
    method: "POST",
    body: JSON.stringify(point),
  });
  log(`tap ${point.x}, ${point.y}`);
}

async function sendSwipe(start, end, durationMs) {
  const serial = $("deviceSelect").value;
  await api(`/api/devices/${encodeURIComponent(serial)}/swipe`, {
    method: "POST",
    body: JSON.stringify({
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      duration_ms: durationMs,
    }),
  });
  log(`swipe ${start.x},${start.y} -> ${end.x},${end.y}`);
}

// ═══════════════════════════════════════════════════════
// Wireless connect / pairing
// ═══════════════════════════════════════════════════════
$("connectBtn2").addEventListener("click", async () => {
  const ip = $("wirelessIp").value || "192.168.1.100";
  const port = $("wirelessPort").value || "5555";
  const btn = $("connectBtn2");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  try {
    const data = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ address: `${ip}:${port}` }),
    });
    log(`Wireless connected: ${data.message}`);
    await loadDevices();
  } catch (error) {
    log(`Connection failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Connect";
  }
});

$("pairBtn").addEventListener("click", async () => {
  const ip = $("wirelessIp").value || "192.168.1.100";
  const port = $("wirelessPort").value || "5555";
  const code = $("pairCode").value;
  if (!code) {
    log("Pairing error: Pairing Code is required");
    return;
  }
  const btn = $("pairBtn");
  btn.disabled = true;
  btn.textContent = "Pairing...";
  try {
    const data = await api("/api/pair", {
      method: "POST",
      body: JSON.stringify({ address: `${ip}:${port}`, code }),
    });
    log(`Pairing success: ${data.message}`);
    $("wirelessPort").value = "";
    $("pairCode").value = "";
    await loadDevices();
  } catch (error) {
    log(`Pairing failed: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Pair";
  }
});

$("refreshDevices").addEventListener("click", () => loadDevices().catch((error) => log(error.message)));
$("connectBtn").addEventListener("click", connectStream);
$("deviceSelect").addEventListener("change", async (event) => {
  state.selected = event.target.value;
  await updateDeviceResolution();
});

document.querySelectorAll("[data-key]").forEach((button) => {
  button.addEventListener("click", async () => {
    const serial = $("deviceSelect").value;
    const key = button.dataset.key;
    await api(`/api/devices/${encodeURIComponent(serial)}/keyevent`, {
      method: "POST",
      body: JSON.stringify({ key }),
    });
    log(`key ${key}`);
  });
});

$("sendText").addEventListener("click", async () => {
  const serial = $("deviceSelect").value;
  const input = $("textInput");
  if (!input.value) return;
  await api(`/api/devices/${encodeURIComponent(serial)}/text`, {
    method: "POST",
    body: JSON.stringify({ text: input.value }),
  });
  log(`text "${input.value}"`);
  input.value = "";
});

// ═══════════════════════════════════════════════════════
// Pointer events on canvas + scroll/wheel
// ═══════════════════════════════════════════════════════
let accumulatedDeltaY = 0;
let isScrolling = false;

canvas.addEventListener("pointerdown", (event) => {
  if (!state.videoWidth) return;
  canvas.setPointerCapture(event.pointerId);
  state.dragStart = {
    ...activePoint(event),
    time: performance.now(),
  };
});

canvas.addEventListener("pointerup", async (event) => {
  if (!state.dragStart || !state.videoWidth) return;
  const end = activePoint(event);
  const start = state.dragStart;
  state.dragStart = null;
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  try {
    if (distance < 12) {
      await sendTap(end);
    } else {
      await sendSwipe(start, end, Math.round(performance.now() - start.time));
    }
  } catch (error) {
    log(error.message);
  }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const width = state.videoWidth;
  const height = state.videoHeight;
  if (!width || !height) return;

  if (accumulatedDeltaY !== 0 && Math.sign(event.deltaY) !== Math.sign(accumulatedDeltaY)) {
    accumulatedDeltaY = 0;
  }
  accumulatedDeltaY += event.deltaY;
  const pt = activePoint(event);

  if (isScrolling) return;
  isScrolling = true;

  setTimeout(async () => {
    const totalDelta = accumulatedDeltaY;
    accumulatedDeltaY = 0;

    if (Math.abs(totalDelta) < 10) {
      isScrolling = false;
      return;
    }

    const swipeDistance = Math.min(height * 0.4, Math.max(50, Math.abs(totalDelta) * 2));
    const startY = pt.y;
    let endY = pt.y;

    if (totalDelta > 0) {
      endY = Math.round(Math.max(10, startY - swipeDistance));
    } else {
      endY = Math.round(Math.min(height - 10, startY + swipeDistance));
    }

    if (Math.abs(endY - startY) > 10) {
      try {
        await sendSwipe({ x: pt.x, y: startY }, { x: pt.x, y: endY }, 250);
      } catch (error) {
        log(error.message || String(error));
      }
    }

    // Add an extra 50ms safety cooldown after the actual ADB network call returns
    setTimeout(() => {
      isScrolling = false;
    }, 50);
  }, 50);
}, { passive: false });

// ═══════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════
loadDevices()
  .then(() => setStatus("Ready", "Select a device and connect"))
  .catch((error) => {
    setStatus("ADB error", error.message);
    log(error.message);
  });
