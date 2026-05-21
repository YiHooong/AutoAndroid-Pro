const state = {
  devices: [],
  selected: "",
  ws: null,
  // WebCodecs engine
  decoder: null,
  parser: null,
  videoWidth: 0,
  videoHeight: 0,
  nativeWidth: 0,
  nativeHeight: 0,
  // Interaction
  dragStart: null,
  // FPS Tracking
  frameCount: 0,
  lastFpsTime: 0,
  fpsIntervalId: null,
  smoothedFps: 0,
};

const TRANSLATIONS = {
  zh: {
    titleDevices: "设备列表",
    titleWireless: "无线连接",
    titleStream: "视频流配置",
    titleControls: "快捷控制台",
    titleInteractive: "设置",
    labelIp: "主机 IP 地址",
    labelPort: "端口号 (Port)",
    labelPairCode: "配对码 (Android 11+)",
    btnPair: "开始配对",
    btnConnect: "开始连接",
    labelMaxRes: "最大分辨率上限",
    labelFps: "帧率",
    labelBitrate: "视频码率",
    btnStartStream: "开始推流",
    btnStopStream: "停止推流",
    btnKeyBack: "返回键",
    btnKeyHome: "主页键",
    btnKeyRecent: "任务键",
    btnKeyPower: "电源键",
    btnSendText: "发送",
    labelSwipeDuration: "自定义滑动耗时 (毫秒)",
    labelSmoothScroll: "启用鼠标平滑滚动",
    labelLanguage: "显示语言 / Language",
    placeholderText: "输入文本发送到手机...",
    emptyStateText: "当前无活跃画面流",
    titleLog: "运行日志",
  },
  en: {
    titleDevices: "Devices",
    titleWireless: "Wireless Connect",
    titleStream: "Stream Settings",
    titleControls: "Controls",
    titleInteractive: "Settings",
    labelIp: "Host / IP Address",
    labelPort: "Port",
    labelPairCode: "Pairing Code (Android 11+)",
    btnPair: "Pair",
    btnConnect: "Connect",
    labelMaxRes: "Max Resolution",
    labelFps: "FPS",
    labelBitrate: "Bitrate",
    btnStartStream: "Start Stream",
    btnStopStream: "Stop Stream",
    btnKeyBack: "Back",
    btnKeyHome: "Home",
    btnKeyRecent: "Recent",
    btnKeyPower: "Power",
    btnSendText: "Send",
    labelSwipeDuration: "Swipe Duration Override (ms)",
    labelSmoothScroll: "Smooth Wheel Scroll",
    labelLanguage: "Language / 语言切换",
    placeholderText: "Type text...",
    emptyStateText: "No active stream",
    titleLog: "Activity Log",
  }
};

const $ = (id) => document.getElementById(id);
const canvas = $("phoneCanvas");
const ctx = canvas.getContext("2d");
const emptyState = $("emptyState");

function applyLanguage(lang) {
  const dict = TRANSLATIONS[lang];
  if (!dict) return;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key]) {
      el.textContent = dict[key];
    }
  });
  $("textInput").placeholder = dict.placeholderText;
  localStorage.setItem("language", lang);
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  const container = $("logs");
  container.insertBefore(item, container.firstChild);
  container.scrollTop = 0;
  // Limit to 200 logs to prevent DOM node leakage and performance degradation
  while (container.children.length > 200) {
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
    let match = res.raw.match(/Override size:\s*(\d+)x(\d+)/i);
    if (!match) {
      match = res.raw.match(/Physical size:\s*(\d+)x(\d+)/i);
    }
    if (!match) {
      match = res.raw.match(/(\d+)x(\d+)/);
    }
    if (match) {
      const w = parseInt(match[1]);
      const h = parseInt(match[2]);
      state.nativeWidth = w;
      state.nativeHeight = h;
      const maxDim = Math.max(w, h);
      $("maxSize").value = maxDim;
      log(`Device resolution loaded: ${w}x${h} (Max: ${maxDim}px)`);
    } else {
      $("maxSize").value = "1280";
      state.nativeWidth = 0;
      state.nativeHeight = 0;
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

class AnnexBParser {
  constructor(onNal) {
    this.onNal = onNal;
    this.buffer = new Uint8Array(512 * 1024); // Preallocated 512KB ring buffer
    this.length = 0;
  }

  append(data) {
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
    const len = this.length - 4;
    for (let i = start; i <= len; i++) {
      if (this.buffer[i] === 0 && this.buffer[i + 1] === 0) {
        if (this.buffer[i + 2] === 1) return i;
        if (this.buffer[i + 2] === 0 && this.buffer[i + 3] === 1) return i;
      }
    }
    return -1;
  }
}

function startFpsCounter() {
  stopFpsCounter();
  
  const fpsCounter = $("fpsCounter");
  fpsCounter.style.display = "inline-flex";
  fpsCounter.textContent = "0 FPS";
  
  state.frameCount = 0;
  state.lastFpsTime = performance.now();
  
  state.fpsIntervalId = setInterval(() => {
    const now = performance.now();
    const elapsedMs = now - state.lastFpsTime;
    if (elapsedMs <= 0) return;
    
    const currentFrames = state.frameCount;
    state.frameCount = 0;
    
    const rawFps = Math.round((currentFrames * 1000) / elapsedMs);
    const targetFps = Number($("maxFps").value) || 120;
    
    // Smooth zero presentation when static, capped at target display refresh rate
    const finalFps = currentFrames > 0 ? Math.min(targetFps, rawFps) : 0;
    
    fpsCounter.textContent = `${finalFps} FPS`;
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

  try {
    log("Engine: Launching WebCodecs (Hardware Accelerated)...");
    canvas.style.display = "block";
    canvas.classList.add("active");

    state.decoder = new VideoDecoder({
      output(frame) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          state.videoWidth = frame.displayWidth;
          state.videoHeight = frame.displayHeight;
        }
        
        // Zero-copy highly optimized WebGL/Bitmap rendering path
        createImageBitmap(frame).then(bitmap => {
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
        });
        frame.close();
        state.frameCount++;
      },
      error(e) {
        log(`Decoder runtime error: ${e.message}`);
        console.error("WebCodecs runtime error:", e);
        resetStream();
      }
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

        if (nalType === 5) { // IDR / Key Frame
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
  } catch (err) {
    log(`WebCodecs configuration failed: ${err.message}`);
    resetStream();
    return;
  }

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
// Real-time touch control via scrcpy control protocol
// Inspired by ws-scrcpy's FeaturedInteractionHandler
// Binary format: TYPE(1) + ACTION(1) + POINTER_ID(8) + X(4) + Y(4) + W(2) + H(2) + PRESSURE(2) + BUTTONS(4) = 28 bytes
// ═══════════════════════════════════════════════════════

const SCRCPY_CONTROL = {
  TYPE_TOUCH: 2,
  ACTION_DOWN: 0,
  ACTION_UP: 1,
  ACTION_MOVE: 2,
  BUTTON_PRIMARY: 1,       // left click
  BUTTON_SECONDARY: 2,     // right click (back)
  BUTTON_TERTIARY: 4,      // middle click
  MAX_PRESSURE: 0xFFFF,
  TYPE_BACK_OR_SCREEN_ON: 4,   // inject keycode
  KEYCODE_BACK: 4,
};

function activePoint(event) {
  const rect = canvas.getBoundingClientRect();
  const width = state.videoWidth;
  if (!width) return { x: 0, y: 0 };

  let targetWidth = state.nativeWidth || state.videoWidth;
  let targetHeight = state.nativeHeight || state.videoHeight;

  // Handle dynamic screen rotation coordinate swapping
  const streamIsLandscape = state.videoWidth > state.videoHeight;
  const nativeIsLandscape = targetWidth > targetHeight;
  if (streamIsLandscape !== nativeIsLandscape) {
    const temp = targetWidth;
    targetWidth = targetHeight;
    targetHeight = temp;
  }

  const scaleX = targetWidth / rect.width;
  const scaleY = targetHeight / rect.height;
  return {
    x: Math.max(0, Math.round((event.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.round((event.clientY - rect.top) * scaleY)),
  };
}

function buildTouchMessage(action, pointerId, x, y, screenW, screenH, pressure, buttons) {
  // scrcpy inject_touch_event binary format (28 bytes total):
  // type:1 action:1 pointerId:8 x:4 y:4 screenW:2 screenH:2 pressure:2 buttons:4
  const buf = new ArrayBuffer(28);
  const view = new DataView(buf);
  let offset = 0;
  view.setUint8(offset, SCRCPY_CONTROL.TYPE_TOUCH); offset += 1;
  view.setUint8(offset, action); offset += 1;
  // pointerId is long (8 bytes) — upper 4 bytes zero, lower 4 bytes = id
  view.setUint32(offset, 0); offset += 4;
  view.setUint32(offset, pointerId); offset += 4;
  view.setUint32(offset, x); offset += 4;
  view.setUint32(offset, y); offset += 4;
  view.setUint16(offset, screenW); offset += 2;
  view.setUint16(offset, screenH); offset += 2;
  view.setUint16(offset, pressure); offset += 2;
  view.setUint32(offset, buttons); offset += 4;
  return buf;
}

function buildKeyEventMessage(action, keycode) {
  // scrcpy inject_keycode: type:1 action:1 keycode:4 repeat:4 metaState:4 = 14 bytes
  const buf = new ArrayBuffer(14);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_BACK_OR_SCREEN_ON);
  view.setUint8(1, action);  // 0=DOWN, 1=UP
  view.setUint32(2, keycode);
  view.setUint32(6, 0);   // repeat
  view.setUint32(10, 0);  // metaState
  return buf;
}

function sendTouch(action, event, pointerId = 0) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const pt = activePoint(event);
  const screenW = state.videoWidth;
  const screenH = state.videoHeight;
  if (!screenW || !screenH) return;

  const pressure = action === SCRCPY_CONTROL.ACTION_UP ? 0 : SCRCPY_CONTROL.MAX_PRESSURE;
  const buttons = event.button === 2 ? SCRCPY_CONTROL.BUTTON_SECONDARY : SCRCPY_CONTROL.BUTTON_PRIMARY;
  const msg = buildTouchMessage(action, pointerId, pt.x, pt.y, screenW, screenH, pressure, buttons);
  state.ws.send(msg);
}

// Fallback HTTP-based tap/swipe for non-realtime operations
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
// Pointer event handlers — real-time touch via scrcpy protocol
// ═══════════════════════════════════════════════════════

// Prevent context menu on right-click over the canvas
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (event) => {
  const width = state.videoWidth;
  if (!width) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);

  // Right-click → send BACK key
  if (event.button === 2) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(buildKeyEventMessage(0, SCRCPY_CONTROL.KEYCODE_BACK)); // DOWN
      state.ws.send(buildKeyEventMessage(1, SCRCPY_CONTROL.KEYCODE_BACK)); // UP
      log("key BACK (right-click)");
    }
    return;
  }

  // Left-click / touch → real-time ACTION_DOWN
  sendTouch(SCRCPY_CONTROL.ACTION_DOWN, event, event.pointerId);
  state.dragStart = {
    ...activePoint(event),
    time: performance.now(),
    pointerId: event.pointerId,
  };
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragStart) return;
  // Real-time ACTION_MOVE — this is the key difference from our old approach
  // The Android device sees the finger drag in real-time
  sendTouch(SCRCPY_CONTROL.ACTION_MOVE, event, event.pointerId);
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button === 2) return; // right-click handled in pointerdown
  if (!state.dragStart) return;

  // Send ACTION_UP
  sendTouch(SCRCPY_CONTROL.ACTION_UP, event, event.pointerId);

  const end = activePoint(event);
  const start = state.dragStart;
  state.dragStart = null;

  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance < 12) {
    log(`tap ${end.x}, ${end.y}`);
  } else {
    log(`drag ${start.x},${start.y} -> ${end.x},${end.y}`);
  }
});

canvas.addEventListener("pointercancel", (event) => {
  if (state.dragStart) {
    sendTouch(SCRCPY_CONTROL.ACTION_UP, event, event.pointerId);
    state.dragStart = null;
  }
});

// ═══════════════════════════════════════════════════════
// Scroll wheel — mapped to swipe via scrcpy touch protocol
// ═══════════════════════════════════════════════════════
let accumulatedDeltaY = 0;
let isScrolling = false;

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
        const smooth = $("smoothScroll").checked;
        const duration = smooth ? 250 : 80;
        await sendSwipe({ x: pt.x, y: startY }, { x: pt.x, y: endY }, duration);
      } catch (error) {
        log(error.message || String(error));
      }
    }

    setTimeout(() => {
      isScrolling = false;
    }, 50);
  }, 50);
}, { passive: false });

// ═══════════════════════════════════════════════════════
// UI event listeners
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

loadDevices()
  .then(() => setStatus("Ready", "Select a device and connect"))
  .catch((error) => {
    setStatus("ADB error", error.message);
    log(error.message);
  });

$("toggleSettingsBtn").addEventListener("click", () => {
  const panel = $("interactiveSettings");
  const arrow = $("settingsArrow");
  if (panel.style.display === "none") {
    panel.style.display = "flex";
    arrow.style.transform = "rotate(180deg)";
  } else {
    panel.style.display = "none";
    arrow.style.transform = "rotate(0deg)";
  }
});

$("languageSelect").addEventListener("change", (e) => {
  applyLanguage(e.target.value);
});

// Initialize translation system from persistent local preference (defaults to zh/Chinese)
const activeLanguage = localStorage.getItem("language") || "zh";
$("languageSelect").value = activeLanguage;
applyLanguage(activeLanguage);
