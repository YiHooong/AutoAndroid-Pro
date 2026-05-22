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
    labelChunkSizeSelect: "视频流读取数据块大小 (Chunk Size)",
    labelChunkSizeTip: "提示：选择“不设置”时，系统将关闭固定包块限制并开启 socket 直读，适合低延迟投屏。针对高端或弱网设备可按需调大分包大小。",
    labelLanguage: "显示语言 / Language",
    placeholderText: "输入文本发送到手机...",
    emptyStateText: "当前无活跃画面流",
    titleLog: "运行日志",
    shellBtn: "命令行",
    shellTitle: "ADB 命令行控制台",
    shellActiveDevice: "当前设备：",
    shellExecute: "执行",
    shellClear: "清空",
    shellPlaceholder: "输入 ADB 或 Shell 命令 (如: pm list packages -3 或 adb devices)...",
    shellWelcome: "========================================\n欢迎使用 AutoAndroid Pro 智能命令终端。\n当前设备: {serial}\n========================================\n提示: 终端支持智能命令解析。您可以直接输入 `getprop ro.product.model` (默认执行 adb shell)，也可以输入完整的 `adb shell getprop ro.product.model` 或 `adb devices` 等主机指令，系统将自动识别并执行。\n",
    aiSettingsBtnText: "配置 AI 助手",
    aiTitle: "AI 助手参数配置",
    aiLabelProvider: "选择服务商:",
    aiLabelEndpoint: "接口地址 (API Endpoint URL):",
    aiLabelKey: "接口密钥 (API Key / Token):",
    aiLabelModel: "默认模型名称 (Model Name):",
    aiLabelVersion: "Anthropic 版本协议头 (Version Header):",
    aiBtnTest: "测试连接",
    aiBtnSave: "保存配置",
    settingsTitle: "AutoAndroid Pro 参数设置",
    settingsGeneralTab: "通用设置",
    settingsAiTab: "AI 配置",
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
    labelChunkSizeSelect: "Read Chunk Size Selection",
    labelChunkSizeTip: "Tip: Selecting 'No Limit' disables packet framing limits, resulting in raw socket direct reading (recommended for lowest latency). You can select 4KB-64KB chunk parameters if needed.",
    labelLanguage: "Language / 语言切换",
    placeholderText: "Type text...",
    emptyStateText: "No active stream",
    titleLog: "Activity Log",
    shellBtn: "Shell",
    shellTitle: "ADB Command Terminal",
    shellActiveDevice: "Active Device:",
    shellExecute: "Execute",
    shellClear: "Clear",
    shellPlaceholder: "Enter ADB or Shell command (e.g., pm list packages -3 or adb devices)...",
    shellWelcome: "========================================\nWelcome to AutoAndroid Pro Command Terminal.\nActive Device: {serial}\n========================================\nTip: The terminal supports intelligent parsing. You can enter `getprop ro.product.model` (runs adb shell ro.product.model), or full commands like `adb shell getprop ro.product.model` or `adb devices`, and the system will automatically execute them.\n",
    aiSettingsBtnText: "Configure AI",
    aiTitle: "AI Configuration",
    aiLabelProvider: "Select Provider:",
    aiLabelEndpoint: "API Base Endpoint URL:",
    aiLabelKey: "API Key:",
    aiLabelModel: "Model Name:",
    aiLabelVersion: "Anthropic Version Header:",
    aiBtnTest: "Test Connection",
    aiBtnSave: "Save Settings",
    settingsTitle: "AutoAndroid Pro Settings",
    settingsGeneralTab: "General Settings",
    settingsAiTab: "AI Configuration",
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
  $("shellCommandInput").placeholder = dict.shellPlaceholder;
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
    await updateDeviceResolution();
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

let connectionMonitorId = null;

function startConnectionMonitor(serial) {
  stopConnectionMonitor();
  connectionMonitorId = setInterval(async () => {
    try {
      const res = await api('/api/devices');
      if (res && res.devices) {
        const found = res.devices.find(d => d.serial === serial && d.state === "device");
        if (!found) {
          log(`Device ${serial} disconnected unexpectedly.`);
          resetStream(true, "Device Disconnected / 连接已断开");
          loadDevices();
        }
      }
    } catch (e) {
      // Ignore API errors
    }
  }, 2500);
}

function stopConnectionMonitor() {
  if (connectionMonitorId) {
    clearInterval(connectionMonitorId);
    connectionMonitorId = null;
  }
}

function resetStream(isUnexpected = false, reason = "") {
  stopFpsCounter();
  stopConnectionMonitor();

  if (state.ws) {
    state.ws.onclose = null; // Prevent re-triggering
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

  if (isUnexpected && state.videoWidth && state.videoHeight) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff3b30";
    
    // Scale font size based on canvas width (approx 6% of width, minimum 36px)
    const fontSize = Math.max(36, Math.floor(canvas.width * 0.06));
    ctx.font = `bold ${fontSize}px 'Inter', sans-serif`;
    
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(reason || "Stream Disconnected / 视频流已断开", canvas.width / 2, canvas.height / 2);
  } else {
    state.videoWidth = 0;
    state.videoHeight = 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.display = "none";
    canvas.classList.remove("active");
    emptyState.style.display = "block";
  }

  $("fullscreenBtn").style.display = "none";
  if ($("navOverlay")) $("navOverlay").style.display = "none";

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

  const chunkSize = Number(chunkSizeSelect.value) || 0;

  const bitRate = ($("bitRateValue").value || "8") + $("bitRateUnit").value;
  const params = new URLSearchParams({
    serial,
    max_size: $("maxSize").value || "1280",
    max_fps: $("maxFps").value || "0",
    bit_rate: bitRate,
    chunk_size: chunkSize,
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
    const dev = state.devices.find(d => d.serial === serial);
    let detail = serial;
    if (dev) {
      const model = dev.model || "";
      const product = dev.product || "";
      if (model && product) {
        detail = `${serial} / ${model}(${product})`;
      } else if (model) {
        detail = `${serial} / ${model}`;
      } else if (product) {
        detail = `${serial} / ${product}`;
      }
    }
    setStatus("Streaming", detail);
    emptyState.style.display = "none";
    $("fullscreenBtn").style.display = "flex";
    updateNavOverlayVisibility();
    log(`stream connected: ${serial}`);
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg> Stop Stream`;
    btn.classList.add("streaming-active");
    startFpsCounter();
    startConnectionMonitor(serial);
  };

  ws.onmessage = (event) => {
    if (state.parser) {
      state.parser.append(new Uint8Array(event.data));
    }
  };

  ws.onerror = () => {
    setStatus("Stream error", "Check backend scrcpy logs");
    log("stream error");
    resetStream(true, "Stream Error / 视频流出错");
    loadDevices();
  };

  ws.onclose = (event) => {
    setStatus("Disconnected", event.reason || "stream closed");
    log(`stream closed${event.reason ? `: ${event.reason}` : ""}`);
    resetStream(true, "Stream Closed / 视频流已关闭");
    loadDevices();
  };
}

// ═══════════════════════════════════════════════════════
// Real-time touch control via scrcpy control protocol
// Inspired by ws-scrcpy's FeaturedInteractionHandler
//
// scrcpy v1.25 wire format (from control_msg.c):
//   INJECT_TOUCH_EVENT (type=2): 28 bytes
//     type(1) + action(1) + pointerId(8) + x(4) + y(4) + w(2) + h(2) + pressure(2) + buttons(4)
//   BACK_OR_SCREEN_ON (type=4): 2 bytes
//     type(1) + action(1)
//   INJECT_KEYCODE (type=0): 14 bytes
//     type(1) + action(1) + keycode(4) + repeat(4) + metaState(4)
// ═══════════════════════════════════════════════════════

const SCRCPY_CONTROL = {
  TYPE_INJECT_KEYCODE: 0,
  TYPE_INJECT_TOUCH_EVENT: 2,
  TYPE_INJECT_SCROLL_EVENT: 3,
  TYPE_BACK_OR_SCREEN_ON: 4,
  ACTION_DOWN: 0,
  ACTION_UP: 1,
  ACTION_MOVE: 2,
  BUTTON_PRIMARY: 1,       // left click
  BUTTON_SECONDARY: 2,     // right click
  BUTTON_TERTIARY: 4,      // middle click
  MAX_PRESSURE: 0xFFFF,
  KEYCODE_BACK: 4,
  KEYCODE_HOME: 3,
  KEYCODE_APP_SWITCH: 187,
  KEYCODE_POWER: 26,
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

function buildTouchMessage(action, pointerId, x, y, screenW, screenH, pressure, buttons, action_button = 0) {
  // scrcpy v4 inject_touch_event: 32 bytes total
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_TOUCH_EVENT);
  view.setUint8(1, action);
  // pointerId is uint64 (8 bytes)
  view.setUint32(2, 0);           // upper 4 bytes
  view.setUint32(6, pointerId);   // lower 4 bytes
  view.setUint32(10, x);
  view.setUint32(14, y);
  view.setUint16(18, screenW);
  view.setUint16(20, screenH);
  view.setUint16(22, pressure);
  view.setUint32(24, action_button);          // action_button
  view.setUint32(28, buttons);
  return buf;
}

function buildScrollMessage(x, y, screenW, screenH, hscrollVal, vscrollVal, buttons = 0) {
  // scrcpy v4 inject_scroll_event: 21 bytes total
  const buf = new ArrayBuffer(21);
  const view = new DataView(buf);

  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_SCROLL_EVENT);

  // position: 12 bytes
  view.setInt32(1, x);
  view.setInt32(5, y);
  view.setUint16(9, screenW);
  view.setUint16(11, screenH);

  // hscroll Q15 conversion
  let hscroll_norm = hscrollVal / 16;
  hscroll_norm = Math.max(-1, Math.min(1, hscroll_norm));
  let hscroll_q15 = Math.round(hscroll_norm * 32768);
  if (hscroll_q15 < -32768) hscroll_q15 = -32768;
  if (hscroll_q15 > 32767) hscroll_q15 = 32767;

  // vscroll Q15 conversion
  let vscroll_norm = vscrollVal / 16;
  vscroll_norm = Math.max(-1, Math.min(1, vscroll_norm));
  let vscroll_q15 = Math.round(vscroll_norm * 32768);
  if (vscroll_q15 < -32768) vscroll_q15 = -32768;
  if (vscroll_q15 > 32767) vscroll_q15 = 32767;

  view.setInt16(13, hscroll_q15);
  view.setInt16(15, vscroll_q15);

  // buttons state
  view.setUint32(17, buttons);

  return buf;
}

function buildBackOrScreenOn(action) {
  // scrcpy v1.25 BACK_OR_SCREEN_ON: 2 bytes total
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_BACK_OR_SCREEN_ON);
  view.setUint8(1, action);  // 0=DOWN, 1=UP
  return buf;
}

function buildKeyEventMessage(action, keycode) {
  // scrcpy v1.25 inject_keycode: 14 bytes total
  const buf = new ArrayBuffer(14);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_KEYCODE);
  view.setUint8(1, action);  // 0=DOWN, 1=UP
  view.setUint32(2, keycode);
  view.setUint32(6, 0);   // repeat
  view.setUint32(10, 0);  // metaState
  return buf;
}

function sendTouch(action, x, y, pressure, buttons, action_button = 0) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const screenW = state.videoWidth;
  const screenH = state.videoHeight;
  if (!screenW || !screenH) return;
  // Always use pointerId=0 for single-pointer mouse (same as ws-scrcpy)
  const msg = buildTouchMessage(action, 0, x, y, screenW, screenH, pressure, buttons, action_button);
  state.ws.send(msg);
}

// Fallback HTTP-based tap/swipe for non-realtime operations (scroll wheel uses this)
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
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const behavior = localStorage.getItem("right_click_behavior") || "back";
  if (behavior === "menu") {
    showContextMenu(e.clientX, e.clientY);
  }
});

canvas.addEventListener("pointerdown", (event) => {
  if (!state.videoWidth) return;
  event.preventDefault();

  // Right-click → BACK_OR_SCREEN_ON (2 bytes, type=4)
  if (event.button === 2) {
    const behavior = localStorage.getItem("right_click_behavior") || "back";
    if (behavior === "back") {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(buildBackOrScreenOn(SCRCPY_CONTROL.ACTION_DOWN));
        state.rightClickActive = true;
      }
    }
    return;  // Don't set dragStart, don't capture pointer
  }

  // Left-click / touch — capture and send ACTION_DOWN
  canvas.setPointerCapture(event.pointerId);
  const pt = activePoint(event);
  sendTouch(SCRCPY_CONTROL.ACTION_DOWN, pt.x, pt.y, SCRCPY_CONTROL.MAX_PRESSURE, SCRCPY_CONTROL.BUTTON_PRIMARY);
  state.dragStart = {
    x: pt.x,
    y: pt.y,
    time: performance.now(),
    button: SCRCPY_CONTROL.BUTTON_PRIMARY,
  };
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragStart) return;
  const pt = activePoint(event);
  // Use the button stored from pointerdown, NOT event.button (which is 0 during move)
  sendTouch(SCRCPY_CONTROL.ACTION_MOVE, pt.x, pt.y, SCRCPY_CONTROL.MAX_PRESSURE, state.dragStart.button);
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button === 2) {
    const behavior = localStorage.getItem("right_click_behavior") || "back";
    if (behavior === "back" && state.rightClickActive) {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(buildBackOrScreenOn(SCRCPY_CONTROL.ACTION_UP));
      }
      state.rightClickActive = false;
      log("key BACK (right-click)");
    }
    return;
  }
  if (!state.dragStart) return;

  const pt = activePoint(event);
  sendTouch(SCRCPY_CONTROL.ACTION_UP, pt.x, pt.y, 0, state.dragStart.button);

  const start = state.dragStart;
  state.dragStart = null;

  const distance = Math.hypot(pt.x - start.x, pt.y - start.y);
  if (distance < 12) {
    log(`tap ${pt.x}, ${pt.y}`);
  } else {
    log(`drag ${start.x},${start.y} -> ${pt.x},${pt.y}`);
  }
});

canvas.addEventListener("pointercancel", (event) => {
  if (state.rightClickActive) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(buildBackOrScreenOn(SCRCPY_CONTROL.ACTION_UP));
    }
    state.rightClickActive = false;
  }
  if (state.dragStart) {
    const pt = activePoint(event);
    sendTouch(SCRCPY_CONTROL.ACTION_UP, pt.x, pt.y, 0, state.dragStart.button);
    state.dragStart = null;
  }
});

canvas.addEventListener("wheel", (event) => {
  if (!state.videoWidth) return;
  event.preventDefault();

  const pt = activePoint(event);
  const screenW = state.videoWidth;
  const screenH = state.videoHeight;
  if (!screenW || !screenH) return;

  // Invert scroll directions for natural browser scrolling mapping:
  const hscroll = -event.deltaX;
  const vscroll = -event.deltaY;

  // Support deltaModes (lines or pages)
  let scale = 1.0;
  if (event.deltaMode === 1) { // deltaMode = lines
    scale = 40;
  } else if (event.deltaMode === 2) { // deltaMode = pages
    scale = 800;
  }
  const hscroll_notches = (hscroll * scale) / 120;
  const vscroll_notches = (vscroll * scale) / 120;

  // scrcpy native expects values in the range [-16, 16] notches.
  const hscroll_clamped = Math.max(-16, Math.min(16, hscroll_notches));
  const vscroll_clamped = Math.max(-16, Math.min(16, vscroll_notches));

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    const msg = buildScrollMessage(pt.x, pt.y, screenW, screenH, hscroll_clamped, vscroll_clamped, 0);
    state.ws.send(msg);
  }
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

$("fullscreenBtn").addEventListener("click", () => {
  const wrap = document.querySelector(".phone-wrap");
  if (!document.fullscreenElement) {
    wrap.requestFullscreen().catch(err => {
      log(`Error enabling fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
});

function updateNavOverlayVisibility() {
  if (!state.ws) {
    if ($("navOverlay")) $("navOverlay").style.display = "none";
    return;
  }
  const isFullscreen = !!document.fullscreenElement;
  const navBarBehavior = localStorage.getItem("nav_bar_behavior") || "hide";
  
  if (isFullscreen || navBarBehavior === "show") {
    $("navOverlay").style.display = "flex";
  } else {
    $("navOverlay").style.display = "none";
  }
}

document.addEventListener("fullscreenchange", () => {
  const btn = $("fullscreenBtn");
  if (document.fullscreenElement) {
    btn.innerHTML = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"></path></svg>`;
  } else {
    btn.innerHTML = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
  }
  updateNavOverlayVisibility();
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



$("languageSelect").addEventListener("change", (e) => {
  applyLanguage(e.target.value);
});

// Initialize translation system from persistent local preference (defaults to zh/Chinese)
const activeLanguage = localStorage.getItem("language") || "zh";
$("languageSelect").value = activeLanguage;
applyLanguage(activeLanguage);

// ═══════════════════════════════════════════════════════
// ADB Shell Modal Logic
// ═══════════════════════════════════════════════════════
const shellModal = $("shellModal");
const shellOutput = $("shellOutput");
const shellCommandInput = $("shellCommandInput");
const shellTargetDevice = $("shellTargetDevice");

let lastShellDevice = "";

$("shellBtn").addEventListener("click", () => {
  const serial = $("deviceSelect").value;
  if (!serial) {
    alert("Please connect/select a device first.");
    return;
  }
  shellTargetDevice.textContent = serial;
  if (serial !== lastShellDevice) {
    lastShellDevice = serial;
    const currentLang = localStorage.getItem("language") || "zh";
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.zh;
    const welcomeMsg = dict.shellWelcome.replace("{serial}", serial);
    if (shellOutput.textContent.trim() === "") {
      shellOutput.textContent = welcomeMsg;
    } else {
      shellOutput.textContent += `\n${welcomeMsg}`;
    }
  }
  shellModal.style.display = "flex";
  shellCommandInput.value = "";
  setTimeout(() => {
    shellCommandInput.focus();
    shellOutput.scrollTop = shellOutput.scrollHeight;
  }, 100);
});

$("closeShellModal").addEventListener("click", () => {
  shellModal.style.display = "none";
});

shellModal.addEventListener("click", (e) => {
  if (e.target === shellModal) {
    shellModal.style.display = "none";
  }
});

const shellHistory = [];
let shellHistoryIdx = -1;
let shellTempCmd = "";

async function executeShellCommand() {
  const serial = $("deviceSelect").value;
  const command = shellCommandInput.value.trim();
  if (!command || !serial) return;

  // Handle local clear command
  if (command.toLowerCase() === "clear") {
    shellOutput.textContent = "";
    shellCommandInput.value = "";
    if (shellHistory[shellHistory.length - 1] !== command) {
      shellHistory.push(command);
    }
    shellHistoryIdx = -1;
    return;
  }

  // Push to history
  if (shellHistory[shellHistory.length - 1] !== command) {
    shellHistory.push(command);
  }
  shellHistoryIdx = -1;

  let logCmd = command;
  if (logCmd.startsWith("adb shell ")) {
    logCmd = `$ ${logCmd}`;
  } else if (logCmd.startsWith("adb ")) {
    logCmd = `$ ${logCmd}`;
  } else {
    logCmd = `$ adb shell ${logCmd}`;
  }
  shellOutput.textContent += `\n\n${logCmd}\n`;
  shellOutput.scrollTop = shellOutput.scrollHeight;
  shellCommandInput.value = "";
  shellCommandInput.disabled = true;
  $("runShellCmdBtn").disabled = true;

  try {
    const res = await api(`/api/devices/${encodeURIComponent(serial)}/shell`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    shellOutput.textContent += res.output || "(No output)\n";
  } catch (error) {
    shellOutput.textContent += `Error: ${error.message}\n`;
  } finally {
    shellCommandInput.disabled = false;
    $("runShellCmdBtn").disabled = false;
    shellCommandInput.focus();
    shellOutput.scrollTop = shellOutput.scrollHeight;
  }
}

$("runShellCmdBtn").addEventListener("click", executeShellCommand);
$("clearShellBtn").addEventListener("click", () => {
  shellOutput.textContent = "";
  shellCommandInput.value = "";
  shellCommandInput.focus();
});

shellCommandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    executeShellCommand();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (shellHistory.length === 0) return;
    if (shellHistoryIdx === -1) {
      shellTempCmd = shellCommandInput.value;
      shellHistoryIdx = shellHistory.length - 1;
    } else if (shellHistoryIdx > 0) {
      shellHistoryIdx--;
    }
    shellCommandInput.value = shellHistory[shellHistoryIdx];
    setTimeout(() => {
      shellCommandInput.selectionStart = shellCommandInput.selectionEnd = shellCommandInput.value.length;
    }, 0);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (shellHistoryIdx === -1) return;
    if (shellHistoryIdx < shellHistory.length - 1) {
      shellHistoryIdx++;
      shellCommandInput.value = shellHistory[shellHistoryIdx];
    } else {
      shellHistoryIdx = -1;
      shellCommandInput.value = shellTempCmd;
    }
  }
});

// Global Settings Modal Logic
const settingsModal = $("settingsModal");
const globalSettingsBtn = $("globalSettingsBtn");
const closeSettingsModal = $("closeSettingsModal");
const tabGeneralBtn = $("tabGeneralBtn");
const tabAiBtn = $("tabAiBtn");
const paneGeneral = $("paneGeneral");
const paneAi = $("paneAi");
const settingsStatusArea = $("settingsStatusArea");

// Inputs
const languageSelect = $("languageSelect");
const chunkSizeSelect = $("chunkSizeSelect");
const rightClickBehaviorSelect = $("rightClickBehaviorSelect");
const aiEndpoint = $("aiEndpoint");
const aiKey = $("aiKey");
const aiModelName = $("aiModelName");
const aiVersion = $("aiVersion");
const aiAnthropicExtraGroup = $("aiAnthropicExtraGroup");

let activeProvider = "openai";
let activeSettingsTab = "general";

function setSettingsTab(tab) {
  activeSettingsTab = tab;
  if (tab === "general") {
    tabGeneralBtn.style.background = "#00ff66";
    tabGeneralBtn.style.color = "#0b0d0f";
    tabAiBtn.style.background = "transparent";
    tabAiBtn.style.color = "#aab2b9";
    paneGeneral.style.display = "flex";
    paneAi.style.display = "none";
  } else {
    tabAiBtn.style.background = "#00ff66";
    tabAiBtn.style.color = "#0b0d0f";
    tabGeneralBtn.style.background = "transparent";
    tabGeneralBtn.style.color = "#aab2b9";
    paneGeneral.style.display = "none";
    paneAi.style.display = "flex";
  }
}

tabGeneralBtn.addEventListener("click", () => setSettingsTab("general"));
tabAiBtn.addEventListener("click", () => setSettingsTab("ai"));

function setProvider(provider) {
  activeProvider = provider;
  if (provider === "openai") {
    $("providerOpenAiBtn").style.background = "#00ff66";
    $("providerOpenAiBtn").style.color = "#0b0d0f";
    $("providerAnthropicBtn").style.background = "transparent";
    $("providerAnthropicBtn").style.color = "#aab2b9";
    aiEndpoint.placeholder = "https://api.openai.com/v1";
    aiModelName.placeholder = "gpt-4o";
    aiAnthropicExtraGroup.style.display = "none";
  } else {
    $("providerAnthropicBtn").style.background = "#00ff66";
    $("providerAnthropicBtn").style.color = "#0b0d0f";
    $("providerOpenAiBtn").style.background = "transparent";
    $("providerOpenAiBtn").style.color = "#aab2b9";
    aiEndpoint.placeholder = "https://api.anthropic.com/v1";
    aiModelName.placeholder = "claude-3-5-sonnet-20241022";
    aiAnthropicExtraGroup.style.display = "flex";
  }
  settingsStatusArea.style.display = "none";
}

$("providerOpenAiBtn").addEventListener("click", () => setProvider("openai"));
$("providerAnthropicBtn").addEventListener("click", () => setProvider("anthropic"));

function loadAllSettings() {
  // Load General Settings
  const lang = localStorage.getItem("language") || "zh";
  languageSelect.value = lang;

  chunkSizeSelect.value = localStorage.getItem("chunk_size_select") || "0";
  rightClickBehaviorSelect.value = localStorage.getItem("right_click_behavior") || "back";
  const navBarSelect = $("navBarBehaviorSelect");
  if (navBarSelect) navBarSelect.value = localStorage.getItem("nav_bar_behavior") || "hide";

  // Load AI Settings
  const provider = localStorage.getItem("ai_provider") || "openai";
  setProvider(provider);
  aiEndpoint.value = localStorage.getItem("ai_endpoint") || "";
  aiKey.value = localStorage.getItem("ai_key") || "";
  aiModelName.value = localStorage.getItem("ai_model_name") || "";
  aiVersion.value = localStorage.getItem("ai_version") || "2023-06-01";
  
  settingsStatusArea.style.display = "none";
}

// Initial page load triggers
loadAllSettings();

globalSettingsBtn.addEventListener("click", () => {
  loadAllSettings();
  setSettingsTab("general");
  settingsModal.style.display = "flex";
});

closeSettingsModal.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = "none";
  }
});

// Test Connection Action
$("testAiConnectionBtn").addEventListener("click", async () => {
  settingsStatusArea.style.display = "block";
  settingsStatusArea.style.background = "rgba(255,255,255,0.03)";
  settingsStatusArea.style.border = "1px solid rgba(255,255,255,0.08)";
  settingsStatusArea.style.color = "#e6ebf1";
  settingsStatusArea.textContent = "Testing connection / 正在测试连接...";

  const provider = activeProvider;
  const endpoint = aiEndpoint.value.trim() || aiEndpoint.placeholder;
  const api_key = aiKey.value.trim();
  const model_name = aiModelName.value.trim() || aiModelName.placeholder;
  const anthropic_version = aiVersion.value.trim() || "2023-06-01";

  if (!api_key) {
    settingsStatusArea.style.background = "rgba(255, 59, 48, 0.1)";
    settingsStatusArea.style.border = "1px solid rgba(255, 59, 48, 0.2)";
    settingsStatusArea.style.color = "#ff3b30";
    settingsStatusArea.textContent = "Error: API Key is required / 错误：密钥不能为空！";
    return;
  }

  try {
    const res = await api("/api/ai/test", {
      method: "POST",
      body: JSON.stringify({
        provider,
        endpoint,
        api_key,
        model_name,
        anthropic_version
      })
    });

    if (res.ok) {
      settingsStatusArea.style.background = "rgba(0, 255, 102, 0.1)";
      settingsStatusArea.style.border = "1px solid rgba(0, 255, 102, 0.2)";
      settingsStatusArea.style.color = "#00ff66";
      settingsStatusArea.textContent = `Success / 连接测试成功！\n\nResponse:\n${res.message}`;
    } else {
      settingsStatusArea.style.background = "rgba(255, 59, 48, 0.1)";
      settingsStatusArea.style.border = "1px solid rgba(255, 59, 48, 0.2)";
      settingsStatusArea.style.color = "#ff3b30";
      const detailStr = typeof res.detail === "object" ? JSON.stringify(res.detail, null, 2) : res.detail || "";
      settingsStatusArea.textContent = `Error / 连接测试失败！\n\nDetail:\n${res.error}\n${detailStr}`;
    }
  } catch (err) {
    settingsStatusArea.style.background = "rgba(255, 59, 48, 0.1)";
    settingsStatusArea.style.border = "1px solid rgba(255, 59, 48, 0.2)";
    settingsStatusArea.style.color = "#ff3b30";
    settingsStatusArea.textContent = `Error / 请求失败！\n\nDetail:\n${err.message}`;
  }
});

// Save Settings Action
$("saveSettingsBtn").addEventListener("click", () => {
  // Save General settings
  const selectedLang = languageSelect.value;
  localStorage.setItem("language", selectedLang);
  applyLanguage(selectedLang);

  localStorage.setItem("chunk_size_select", chunkSizeSelect.value);
  localStorage.setItem("right_click_behavior", rightClickBehaviorSelect.value);
  const navBarSelect = $("navBarBehaviorSelect");
  if (navBarSelect) {
    localStorage.setItem("nav_bar_behavior", navBarSelect.value);
    updateNavOverlayVisibility();
  }

  // Save AI settings
  localStorage.setItem("ai_provider", activeProvider);
  localStorage.setItem("ai_endpoint", aiEndpoint.value.trim());
  localStorage.setItem("ai_key", aiKey.value.trim());
  localStorage.setItem("ai_model_name", aiModelName.value.trim());
  localStorage.setItem("ai_version", aiVersion.value.trim());

  settingsStatusArea.style.display = "block";
  settingsStatusArea.style.background = "rgba(0, 255, 102, 0.1)";
  settingsStatusArea.style.border = "1px solid rgba(0, 255, 102, 0.2)";
  settingsStatusArea.style.color = "#00ff66";
  settingsStatusArea.textContent = "Settings saved successfully! / 配置已保存成功！";

  setTimeout(() => {
    settingsModal.style.display = "none";
  }, 1200);
});

// Custom Context Menu Actions & Display
function showContextMenu(clientX, clientY) {
  const menu = $("customContextMenu");
  if (!menu) return;

  // Position context menu, adjusting if it goes off viewport boundaries
  menu.style.display = "block";
  const menuWidth = 180;
  const menuHeight = 220;
  let left = clientX;
  let top = clientY;

  if (clientX + menuWidth > window.innerWidth) {
    left = window.innerWidth - menuWidth - 10;
  }
  if (clientY + menuHeight > window.innerHeight) {
    top = window.innerHeight - menuHeight - 10;
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  // Animation trigger
  setTimeout(() => {
    menu.style.opacity = "1";
    menu.style.transform = "scale(1)";
    menu.style.pointerEvents = "auto";
  }, 10);

  const hideMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.style.opacity = "0";
      menu.style.transform = "scale(0.95)";
      menu.style.pointerEvents = "none";
      setTimeout(() => {
        menu.style.display = "none";
      }, 150);
      document.removeEventListener("click", hideMenu);
      document.removeEventListener("contextmenu", hideMenu);
    }
  };

  setTimeout(() => {
    document.addEventListener("click", hideMenu);
    document.addEventListener("contextmenu", hideMenu);
  }, 50);
}

function registerContextMenuActions() {
  const actions = {
    menuItemBack: { key: "BACK", code: 4 },
    menuItemHome: { key: "HOME", code: 3 },
    menuItemAppSwitch: { key: "APP_SWITCH", code: 187 },
    menuItemPower: { key: "POWER", code: 26 },
    menuItemVolumeUp: { key: "VOLUME_UP", code: 24 },
    menuItemVolumeDown: { key: "VOLUME_DOWN", code: 25 },
  };

  Object.entries(actions).forEach(([id, info]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", async () => {
      // Hide menu immediately
      const menu = $("customContextMenu");
      if (menu) {
        menu.style.opacity = "0";
        menu.style.transform = "scale(0.95)";
        menu.style.pointerEvents = "none";
        setTimeout(() => { menu.style.display = "none"; }, 150);
      }

      // Snappy WebSocket injection or robust HTTP fallback
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        if (info.key === "BACK") {
          state.ws.send(buildBackOrScreenOn(SCRCPY_CONTROL.ACTION_DOWN));
          setTimeout(() => {
            state.ws.send(buildBackOrScreenOn(SCRCPY_CONTROL.ACTION_UP));
          }, 50);
        } else {
          state.ws.send(buildKeyEventMessage(SCRCPY_CONTROL.ACTION_DOWN, info.code));
          setTimeout(() => {
            state.ws.send(buildKeyEventMessage(SCRCPY_CONTROL.ACTION_UP, info.code));
          }, 50);
        }
        log(`key ${info.key} (via ws)`);
      } else {
        const serial = $("deviceSelect").value;
        if (serial) {
          await api(`/api/devices/${encodeURIComponent(serial)}/keyevent`, {
            method: "POST",
            body: JSON.stringify({ key: info.key }),
          });
          log(`key ${info.key} (via api)`);
        }
      }
    });
  });
}

// Register action hooks on load
registerContextMenuActions();

