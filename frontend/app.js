class LowLatencyAudioPlayer {
  constructor(sampleRate = 48000, channels = 2) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.audioCtx = null;
    this.gainNode = null;
    this.workletNode = null;
  }

  async start() {
    if (this.audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn("Web Audio API is not supported in this browser");
      return;
    }
    this.audioCtx = new AudioContextClass({
      sampleRate: this.sampleRate
    });
    await this.audioCtx.audioWorklet.addModule('/assets/audio-worklet-processor.js');
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 1.0;
    this.gainNode.connect(this.audioCtx.destination);
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'audio-ring-buffer', {
      outputChannelCount: [2]
    });
    this.workletNode.connect(this.gainNode);
    console.log("[AudioPlayer] Started with AudioWorklet ring buffer");
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
      this.gainNode = null;
    }
  }

  feed(arrayBuffer) {
    if (!this.audioCtx || !this.workletNode) return;
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
    // Zero-copy transfer of the ArrayBuffer to the worklet thread
    this.workletNode.port.postMessage(arrayBuffer, [arrayBuffer]);
  }
}

const state = {
  devices: [],
  selected: "",
  ws: null,
  audioWs: null,
  audioPlayer: null,
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
  keyboardControlEnabled: false,
  audioForwardEnabled: false,
};

const TRANSLATIONS = {
  zh: {
    titleDevices: "设备列表",
    titleWireless: "无线连接",
    titleStream: "视频流配置",
    titleControls: "快捷控制台",
    titleInteractive: "设置",
    labelIp: "主机 IP 地址",
    labelPort: "端口号",
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
    labelChunkSizeSelect: "视频流数据块大小:",
    labelChunkSizeTip: "提示：选择「不设置」时，系统将关闭固定包块限制并开启 socket 直读，适合低延迟投屏。针对高端或弱网设备可按需调大分包大小。",
    labelLanguage: "显示语言:",
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
    aiLabelEndpoint: "接口地址:",
    aiLabelKey: "接口密钥:",
    aiLabelModel: "模型名称:",
    aiLabelVersion: "Anthropic 版本头:",
    aiBtnTest: "测试连接",
    aiBtnSave: "保存配置",
    settingsTitle: "AutoAndroid Pro 参数设置",
    settingsGeneralTab: "通用设置",
    settingsAiTab: "AI 配置",
    agentThinkingLabel: "思考模式",
    aiLabelSystemPrompt: "系统提示词:",
    aiSystemPromptPlaceholder: "留空使用默认提示词...",
    aiSystemPromptHint: "留空则使用内置默认提示词。自定义内容会覆盖默认提示词。",
    aiLabelStreaming: "流式传输",
    aiLabelImageFormat: "AI 截图上传格式:",
    ctxMenuBack: "返回",
    ctxMenuHome: "主页",
    ctxMenuRecents: "任务切换",
    ctxMenuPower: "电源键",
    ctxMenuVolUp: "音量 +",
    ctxMenuVolDown: "音量 -",
    optChunk0: "不设置 (推荐，延迟更低)",
    optChunk4: "4KB (4096 字节)",
    optChunk8: "8KB (8192 字节)",
    optChunk16: "16KB (16384 字节)",
    optChunk32: "32KB (32768 字节)",
    optChunk64: "64KB (65536 字节)",
    optRightClickBack: "触发返回键 (默认)",
    optRightClickMenu: "弹出自定义右键菜单",
    optBorderShow: "显示边线 (默认)",
    optBorderHide: "隐藏边线",
    optFormatAuto: "自动识别 (根据服务商选择)",
    optFormatImageUrl: "image_url (OpenAI 格式)",
    optFormatBase64: "base64 / image (Anthropic 格式)",
    aiImageFormatHint: "提示：选择「自动识别」时，系统根据 AI 服务商自动选择图片格式。如果使用的兼容 API 格式不匹配，可手动指定。",
    labelRightClickBehavior: "鼠标右键行为:",
    labelRightClickTip: "提示：选择「触发返回键」时，右键直接在投屏区域模拟物理返回。选择「弹出自定义右键菜单」时，右键点击将展开功能操作列表。",
    labelHideBorder: "隐藏投屏区域边线:",
    labelHideBorderTip: "提示：选择「隐藏边线」时，系统将移除投屏画布四周的高亮边框线，使画面在视觉上更加纯净。",
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
    labelChunkSizeSelect: "Stream Chunk Size:",
    labelChunkSizeTip: "Tip: 'No Limit' disables packet framing for raw socket reading (lowest latency). Select 4KB-64KB if needed.",
    labelLanguage: "Language:",
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
    aiLabelProvider: "Provider:",
    aiLabelEndpoint: "API Endpoint:",
    aiLabelKey: "API Key:",
    aiLabelModel: "Model Name:",
    aiLabelVersion: "Anthropic Version:",
    aiBtnTest: "Test Connection",
    aiBtnSave: "Save Settings",
    settingsTitle: "AutoAndroid Pro Settings",
    settingsGeneralTab: "General Settings",
    settingsAiTab: "AI Configuration",
    agentThinkingLabel: "Thinking Mode",
    aiLabelSystemPrompt: "System Prompt:",
    aiSystemPromptPlaceholder: "Leave empty to use default prompt...",
    aiSystemPromptHint: "Leave empty to use the built-in default prompt. Custom content overrides the default.",
    aiLabelStreaming: "Streaming",
    aiLabelImageFormat: "Image Upload Format:",
    ctxMenuBack: "Back",
    ctxMenuHome: "Home",
    ctxMenuRecents: "Recents",
    ctxMenuPower: "Power",
    ctxMenuVolUp: "Volume Up",
    ctxMenuVolDown: "Volume Down",
    optChunk0: "No Limit (Recommended)",
    optChunk4: "4KB (4096 bytes)",
    optChunk8: "8KB (8192 bytes)",
    optChunk16: "16KB (16384 bytes)",
    optChunk32: "32KB (32768 bytes)",
    optChunk64: "64KB (65536 bytes)",
    optRightClickBack: "Back Key (Default)",
    optRightClickMenu: "Context Menu",
    optBorderShow: "Show (Default)",
    optBorderHide: "Hide",
    optFormatAuto: "Auto (Based on provider)",
    optFormatImageUrl: "image_url (OpenAI format)",
    optFormatBase64: "base64 / image (Anthropic format)",
    aiImageFormatHint: "Tip: 'Auto' selects image format based on AI provider. Manually specify if the compatible API format doesn't match.",
    labelRightClickBehavior: "Right-Click Behavior:",
    labelRightClickTip: "Tip: 'Back Key' simulates a physical back button on right-click. 'Context Menu' opens a custom action menu.",
    labelHideBorder: "Hide Stream Border:",
    labelHideBorderTip: "Tip: When set to 'Hide', the highlight border around the stream canvas is removed for a cleaner look.",
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
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (dict[key]) {
      el.placeholder = dict[key];
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

function getDevice(serial) {
  return state.devices.find((device) => device.serial === serial) || null;
}

function deviceLabel(device) {
  if (!device) return "";
  return `${device.serial}${device.model ? ` / ${device.model}` : ""}`;
}

async function tryAuthorizeDevice(serial) {
  const device = getDevice(serial);
  log(`ADB authorization retry: ${deviceLabel(device) || serial}`);
  setStatus("Authorizing", "Trying to reconnect ADB device");
  const result = await api(`/api/devices/${encodeURIComponent(serial)}/authorize`, {
    method: "POST",
  });
  if (result.message) {
    log(`ADB authorization retry result: ${result.message}`);
  }
  await loadDevices(serial);
  const refreshed = getDevice(serial);
  if (refreshed?.state === "device") {
    log(`ADB authorized: ${deviceLabel(refreshed)}`);
    return refreshed;
  }
  const stateText = refreshed?.state || result.device?.state || "not found";
  throw new Error(`Device is still ${stateText}. If no authorization dialog appears, use Android wireless debugging Pair first, then Connect.`);
}

async function requireAuthorizedDevice(serial, actionName = "continue") {
  const device = getDevice(serial);
  if (!device) {
    throw new Error("Selected device is no longer available");
  }
  if (device.state === "device") {
    return device;
  }
  if (device.state === "unauthorized") {
    log(`Device unauthorized before ${actionName}; trying to request authorization...`);
    return tryAuthorizeDevice(serial);
  }
  throw new Error(`Device is ${device.state}, cannot ${actionName}`);
}

async function updateDeviceResolution() {
  const serial = $("deviceSelect").value;
  if (!serial) return;
  const device = getDevice(serial);
  if (device && device.state !== "device") {
    $("maxSize").value = "1280";
    $("maxFps").value = "";
    state.nativeWidth = 0;
    state.nativeHeight = 0;
    setStatus("Device not authorized", `${device.serial} is ${device.state}`);
    log(`Skipped device resolution: ${device.serial} is ${device.state}`);
    return;
  }
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

async function loadDevices(preferredSerial = state.selected) {
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
    const authorized = state.devices.find((device) => device.state === "device");
    const preferred = state.devices.find((device) => device.serial === preferredSerial);
    state.selected = (preferred && preferred.serial) || (authorized && authorized.serial) || state.devices[0].serial;
    select.value = state.selected;
    await updateDeviceResolution();
  } else {
    state.selected = "";
    $("maxSize").value = "1280";
    $("maxFps").value = "";
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
      this.onNal(this.buffer.subarray(offset, nextStart));
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

  const audioPlayer = $("deviceAudioPlayer");
  if (audioPlayer) {
    audioPlayer.src = "";
    try {
      audioPlayer.load();
    } catch (e) {}
  }

  if (state.ws) {
    state.ws.onclose = null; // Prevent re-triggering
    state.ws.close();
    state.ws = null;
  }

  if (state.audioWs) {
    state.audioWs.onclose = null;
    state.audioWs.close();
    state.audioWs = null;
  }
  if (state.audioPlayer) {
    state.audioPlayer.stop();
    state.audioPlayer = null;
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

  if ($("navOverlay")) $("navOverlay").style.display = "none";

  const btn = $("connectBtn");
  btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M5.268 5.268c3.272-3.272 8.573-3.272 11.845 0m-9.016 2.828c1.71-1.71 4.48-1.71 6.19 0m-3.896 2.115a2.5 2.5 0 100 5m0-5a2.5 2.5 0 110 5"></path></svg> Start Stream`;
  btn.disabled = false;
  btn.classList.remove("streaming-active");
}

async function connectStream() {
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
  try {
    await requireAuthorizedDevice(serial, "start stream");
  } catch (err) {
    log(`Stream blocked: ${err.message}`);
    setStatus("Authorization required", err.message);
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M5.268 5.268c3.272-3.272 8.573-3.272 11.845 0m-9.016 2.828c1.71-1.71 4.48-1.71 6.19 0m-3.896 2.115a2.5 2.5 0 100 5m0-5a2.5 2.5 0 110 5"></path></svg> Start Stream`;
    return;
  }

  const chunkSize = Number(chunkSizeSelect.value) || 0;
  const audioForwardEnabled = state.audioForwardEnabled;

  const bitRate = ($("bitRateValue").value || "8") + $("bitRateUnit").value;
  const params = new URLSearchParams({
    serial,
    max_size: $("maxSize").value || "1280",
    max_fps: $("maxFps").value || "0",
    bit_rate: bitRate,
    chunk_size: chunkSize,
    audio: audioForwardEnabled ? "true" : "false",
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
      hardwareAcceleration: "prefer-hardware",
    });

    let hasSeenKeyFrame = false;
    let pendingSps = null;
    let pendingPps = null;
    let dropUntilKeyFrame = false;

    state.parser = new AnnexBParser((nal) => {
      try {
        let offset = 0;
        if (nal[0] === 0 && nal[1] === 0) {
          if (nal[2] === 1) offset = 3;
          else if (nal[2] === 0 && nal[3] === 1) offset = 4;
        }
        const nalType = nal[offset] & 0x1f;

        if (nalType === 7) { // SPS
          pendingSps = nal.slice();
          return;
        }
        if (nalType === 8) { // PPS
          pendingPps = nal.slice();
          return;
        }

        // Drop P-frames when decoder queue backs up
        if (state.decoder.decodeQueueSize > 2) {
          dropUntilKeyFrame = true;
        }

        if (nalType === 5) { // IDR / Key Frame
          dropUntilKeyFrame = false;
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
        } else if (nalType === 1 && hasSeenKeyFrame && !dropUntilKeyFrame) { // Delta Frame
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

  ws.onopen = async () => {
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
     updateNavOverlayVisibility();
     log(`stream connected: ${serial}`);
     btn.disabled = false;
     btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg> Stop Stream`;
     btn.classList.add("streaming-active");
     // Start live audio playback if audio forwarding is enabled
     const audioForwardEnabled = state.audioForwardEnabled;
     if (audioForwardEnabled) {
       log("Connecting real-time low-latency audio stream...");
       try {
         state.audioPlayer = new LowLatencyAudioPlayer(48000, 2);
         await state.audioPlayer.start();
         if (state.audioPlayer.gainNode) {
           state.audioPlayer.gainNode.gain.value = Number($("floatVolumeSlider").value);
         }

        const audioWs = new WebSocket(`${protocol}://${location.host}/ws/audio?serial=${encodeURIComponent(serial)}`);
        audioWs.binaryType = "arraybuffer";
        state.audioWs = audioWs;

        audioWs.onopen = () => {
          log("Audio channel connected successfully / 手机声音流连接成功");
        };

        audioWs.onmessage = (event) => {
          if (state.audioPlayer) {
            state.audioPlayer.feed(event.data);
          }
        };

        audioWs.onerror = (e) => {
          console.warn("Audio WebSocket error:", e);
        };

        audioWs.onclose = () => {
          log("Audio channel disconnected / 手机声音流断开");
          if (state.audioPlayer) {
            state.audioPlayer.stop();
            state.audioPlayer = null;
          }
        };
      } catch (err) {
        log(`Failed to start low latency audio: ${err.message}`);
      }
    }

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
// Inspired by ws-scrcpy and Tango's @yume-chan/scrcpy serializers.
//
// scrcpy v2+ wire format:
//   INJECT_TOUCH_EVENT (type=2): 32 bytes
//     type(1) + action(1) + pointerId(8) + x(4) + y(4) + w(2) + h(2)
//     + pressure u16-float(2) + actionButton(4) + buttons(4)
//   INJECT_SCROLL_EVENT (type=3): 21 bytes
//     type(1) + x(4) + y(4) + w(2) + h(2) + hscroll i16-float(2)
//     + vscroll i16-float(2) + buttons(4)
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
  BUTTON_PRIMARY: 1,
  BUTTON_SECONDARY: 2,
  BUTTON_TERTIARY: 4,
  MAX_PRESSURE: 1,
  POINTER_ID_MOUSE: -1n,
  KEYCODE_BACK: 4,
  KEYCODE_HOME: 3,
  KEYCODE_APP_SWITCH: 187,
  KEYCODE_POWER: 26,
  KEYCODE_A: 29,
  KEYCODE_DEL: 67,
  META_CTRL_ON: 0x1000,
};

function activePoint(event) {
  const rect = canvas.getBoundingClientRect();
  const width = state.videoWidth;
  if (!width) return { x: 0, y: 0 };

  const scaleX = state.videoWidth / rect.width;
  const scaleY = state.videoHeight / rect.height;
  return {
    x: clampNumber((event.clientX - rect.left) * scaleX, 0, state.videoWidth - 1, state.videoWidth / 2),
    y: clampNumber((event.clientY - rect.top) * scaleY, 0, state.videoHeight - 1, state.videoHeight / 2),
  };
}

function setUint64(view, offset, value) {
  let bigint = BigInt(value);
  if (bigint < 0) {
    bigint = (1n << 64n) + bigint;
  }
  view.setUint32(offset, Number((bigint >> 32n) & 0xffffffffn));
  view.setUint32(offset + 4, Number(bigint & 0xffffffffn));
}

function encodeUnsignedFloat16(value) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  return clamped === 1 ? 0xffff : Math.round(clamped * 0x10000);
}

function encodeSignedFloat16(value) {
  const clamped = Math.max(-1, Math.min(1, Number(value) || 0));
  if (clamped === 1) return 0x7fff;
  if (clamped === -1) return -0x8000;
  return Math.round(clamped * 0x8000);
}

function buildTouchMessage(action, pointerId, x, y, screenW, screenH, pressure, buttons, action_button = 0) {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_TOUCH_EVENT);
  view.setUint8(1, action);
  setUint64(view, 2, pointerId);
  view.setUint32(10, x);
  view.setUint32(14, y);
  view.setUint16(18, screenW);
  view.setUint16(20, screenH);
  view.setUint16(22, encodeUnsignedFloat16(pressure));
  view.setUint32(24, action_button);
  view.setUint32(28, buttons);
  return buf;
}

function buildScrollMessage(x, y, screenW, screenH, hscrollVal, vscrollVal, buttons = 0) {
  const buf = new ArrayBuffer(21);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_SCROLL_EVENT);
  view.setInt32(1, x);
  view.setInt32(5, y);
  view.setUint16(9, screenW);
  view.setUint16(11, screenH);
  view.setInt16(13, encodeSignedFloat16(hscrollVal / 16));
  view.setInt16(15, encodeSignedFloat16(vscrollVal / 16));
  view.setUint32(17, buttons);
  return buf;
}

function buildBackOrScreenOn(action) {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_BACK_OR_SCREEN_ON);
  view.setUint8(1, action);
  return buf;
}

function buildKeyEventMessage(action, keycode, metaState = 0) {
  const buf = new ArrayBuffer(14);
  const view = new DataView(buf);
  view.setUint8(0, SCRCPY_CONTROL.TYPE_INJECT_KEYCODE);
  view.setUint8(1, action);
  view.setUint32(2, keycode);
  view.setUint32(6, 0);
  view.setUint32(10, metaState);
  return buf;
}

function buildSetClipboardMessage(text, paste = true) {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(String(text ?? ""));
  const buf = new ArrayBuffer(14 + textBytes.length);
  const view = new DataView(buf);
  view.setUint8(0, 9);
  view.setUint32(1, 0);
  view.setUint32(5, 0);
  view.setUint8(9, paste ? 1 : 0);
  view.setUint32(10, textBytes.length);
  new Uint8Array(buf).set(textBytes, 14);
  return buf;
}

function actionButtonForTouch(action, buttons) {
  if (action === SCRCPY_CONTROL.ACTION_DOWN || action === SCRCPY_CONTROL.ACTION_UP) {
    return buttons;
  }
  return 0;
}

function sendTouch(action, x, y, pressure, buttons, action_button = actionButtonForTouch(action, buttons)) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const screenW = state.videoWidth;
  const screenH = state.videoHeight;
  if (!screenW || !screenH) return;
  const px = clampNumber(x, 0, screenW - 1, screenW / 2);
  const py = clampNumber(y, 0, screenH - 1, screenH / 2);
  const buttonState = action === SCRCPY_CONTROL.ACTION_UP ? 0 : buttons;
  const msg = buildTouchMessage(action, SCRCPY_CONTROL.POINTER_ID_MOUSE, px, py, screenW, screenH, pressure, buttonState, action_button);
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

  // Blur any active browser input elements to restore keyboard focus to the stream
  const activeEl = document.activeElement;
  if (activeEl && (
    activeEl.tagName === "INPUT" ||
    activeEl.tagName === "TEXTAREA" ||
    activeEl.tagName === "SELECT" ||
    activeEl.isContentEditable
  )) {
    activeEl.blur();
  }

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

  // Match Android scroll directions for natural browser scrolling mapping:
  const hscroll = event.deltaX;
  const vscroll = -event.deltaY;

  let hscroll_notches = 0;
  let vscroll_notches = 0;

  if (event.deltaMode === 1) { // deltaMode = lines
    hscroll_notches = hscroll * 0.5;
    vscroll_notches = vscroll * 0.5;
  } else if (event.deltaMode === 2) { // deltaMode = pages
    hscroll_notches = hscroll * 10;
    vscroll_notches = vscroll * 10;
  } else { // deltaMode = pixels (0)
    // Normal mouse tick is ~100-120px. Trackpad outputs tiny delta pixels (1-10px).
    // Map 30 pixels to 1 full notch.
    hscroll_notches = hscroll / 30;
    vscroll_notches = vscroll / 30;

    // Minimum scroll boost threshold to prevent Android's input system from discarding tiny deltas
    const minThreshold = 0.15;
    if (Math.abs(hscroll_notches) > 0 && Math.abs(hscroll_notches) < minThreshold) {
      hscroll_notches = Math.sign(hscroll_notches) * minThreshold;
    }
    if (Math.abs(vscroll_notches) > 0 && Math.abs(vscroll_notches) < minThreshold) {
      vscroll_notches = Math.sign(vscroll_notches) * minThreshold;
    }
  }

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
  const address = `${ip}:${port}`;
  const btn = $("connectBtn2");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  try {
    const data = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ address }),
    });
    log(`Wireless connected: ${data.message}`);
    await loadDevices(address);
    const device = getDevice(address);
    if (device?.state === "unauthorized") {
      btn.textContent = "Authorizing...";
      await tryAuthorizeDevice(address);
    }
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
$("disconnectDevice").addEventListener("click", async () => {
  const serial = $("deviceSelect").value;
  if (!serial) return;
  const btn = $("disconnectDevice");
  btn.disabled = true;
  try {
    const data = await api("/api/disconnect", {
      method: "POST",
      body: JSON.stringify({ address: serial }),
    });
    log(`Disconnected device: ${serial} - ${data.message || 'Success'}`);
    await loadDevices();
  } catch (error) {
    log(`Disconnect failed: ${error.message}`);
  } finally {
    btn.disabled = false;
  }
});
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
    if ($("phoneCanvas")) $("phoneCanvas").style.maxHeight = "100%";
    return;
  }
  const isFullscreen = !!document.fullscreenElement;
  const navBarBehavior = localStorage.getItem("nav_bar_behavior") || "hide";
  
  if (isFullscreen || navBarBehavior === "show") {
    $("navOverlay").style.display = "flex";
    $("phoneCanvas").style.maxHeight = isFullscreen ? "calc(100% - 56px)" : "calc(100% - 48px)";
  } else {
    $("navOverlay").style.display = "none";
    $("phoneCanvas").style.maxHeight = "100%";
  }
}

function updateBorderVisibility() {
  const hideBorder = localStorage.getItem("hide_border") === "true";
  const canvas = $("phoneCanvas");
  if (!canvas) return;
  if (hideBorder) {
    canvas.classList.add("hide-border");
  } else {
    canvas.classList.remove("hide-border");
  }
}

document.addEventListener("fullscreenchange", () => {
  const btn = $("fullscreenBtn");
  const navOverlay = $("navOverlay");
  if (document.fullscreenElement) {
    btn.innerHTML = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"></path></svg>`;
    if (navOverlay) navOverlay.classList.add("fullscreen");
  } else {
    btn.innerHTML = `<svg width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"></path></svg>`;
    if (navOverlay) navOverlay.classList.remove("fullscreen");
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
  const textValue = input.value;
  if (!textValue) return;

  // Copy to local system clipboard
  try {
    await navigator.clipboard.writeText(textValue);
    log(`Copied to local clipboard: "${textValue}"`);
  } catch (e) {
    log(`Local clipboard copy failed: ${e}`);
  }

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    const msg = buildSetClipboardMessage(textValue, true);
    state.ws.send(msg);
    log(`Text pasted via clipboard: "${textValue}"`);
    input.value = "";
  } else if (serial) {
    await api(`/api/devices/${encodeURIComponent(serial)}/text`, {
      method: "POST",
      body: JSON.stringify({ text: textValue }),
    });
    log(`text "${textValue}" (via api)`);
    input.value = "";
  }
});

$("textInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $("sendText").click();
  }
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
const hideBorderSelect = $("hideBorderSelect");
const imageFormatSelect = $("imageFormatSelect");
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
  if (hideBorderSelect) hideBorderSelect.value = localStorage.getItem("hide_border") || "false";
  if (imageFormatSelect) imageFormatSelect.value = localStorage.getItem("ai_image_format") || "auto";
  updateBorderVisibility();

  // Load AI Settings
  const provider = localStorage.getItem("ai_provider") || "openai";
  setProvider(provider);
  aiEndpoint.value = localStorage.getItem("ai_endpoint") || "";
  aiKey.value = localStorage.getItem("ai_key") || "";
  aiModelName.value = localStorage.getItem("ai_model_name") || "";
  aiVersion.value = localStorage.getItem("ai_version") || "2023-06-01";
  $("aiSystemPrompt").value = localStorage.getItem("ai_system_prompt") || "";
  $("aiStreamingToggle").checked = localStorage.getItem("ai_streaming") === "true";

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

// Fetch Models List
$("fetchModelsBtn").addEventListener("click", async () => {
  const container = $("modelListContainer");
  const btn = $("fetchModelsBtn");
  const provider = activeProvider;

  if (provider !== "openai") {
    container.style.display = "block";
    container.innerHTML = '<div style="padding: 10px; font-size: 12px; color: #8a949d;">Model listing only supported for OpenAI-compatible providers.<br>Anthropic 暂不支持获取模型列表。</div>';
    return;
  }

  const endpoint = aiEndpoint.value.trim() || aiEndpoint.placeholder;
  const api_key = aiKey.value.trim();
  if (!api_key) {
    container.style.display = "block";
    container.innerHTML = '<div style="padding: 10px; font-size: 12px; color: #ff3b30;">Please enter API Key first / 请先填写 API Key</div>';
    return;
  }

  btn.disabled = true;
  btn.style.opacity = "0.5";
  container.style.display = "block";
  container.innerHTML = '<div style="padding: 10px; font-size: 12px; color: #aab2b9;">Loading / 加载中...</div>';

  try {
    const res = await api("/api/ai/models", {
      method: "POST",
      body: JSON.stringify({
        provider,
        endpoint,
        api_key,
        model_name: "",
      }),
    });

    if (!res.ok) {
      container.innerHTML = `<div style="padding: 10px; font-size: 12px; color: #ff3b30;">Error: ${res.error}</div>`;
      return;
    }

    const models = res.models || [];
    if (models.length === 0) {
      container.innerHTML = '<div style="padding: 10px; font-size: 12px; color: #8a949d;">No models found / 未找到模型</div>';
      return;
    }

    container.innerHTML = "";
    for (const modelId of models) {
      const item = document.createElement("div");
      item.textContent = modelId;
      item.style.cssText = "padding: 7px 12px; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: #e6ebf1; cursor: pointer; transition: all 0.15s; border-bottom: 1px solid rgba(255,255,255,0.03);";
      item.addEventListener("mouseover", () => { item.style.background = "rgba(0,255,102,0.1)"; item.style.color = "#00ff66"; });
      item.addEventListener("mouseout", () => { item.style.background = "transparent"; item.style.color = "#e6ebf1"; });
      item.addEventListener("click", () => {
        aiModelName.value = modelId;
        container.style.display = "none";
      });
      container.appendChild(item);
    }
  } catch (err) {
    container.innerHTML = `<div style="padding: 10px; font-size: 12px; color: #ff3b30;">Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.style.opacity = "1";
  }
});

// Close model list when clicking outside
document.addEventListener("click", (e) => {
  const container = $("modelListContainer");
  const btn = $("fetchModelsBtn");
  if (container && !container.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    container.style.display = "none";
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
  if (hideBorderSelect) {
    localStorage.setItem("hide_border", hideBorderSelect.value);
    updateBorderVisibility();
  }
  if (imageFormatSelect) {
    localStorage.setItem("ai_image_format", imageFormatSelect.value);
  }

  // Save AI settings
  localStorage.setItem("ai_provider", activeProvider);
  localStorage.setItem("ai_endpoint", aiEndpoint.value.trim());
  localStorage.setItem("ai_key", aiKey.value.trim());
  localStorage.setItem("ai_model_name", aiModelName.value.trim());
  localStorage.setItem("ai_version", aiVersion.value.trim());
  localStorage.setItem("ai_system_prompt", $("aiSystemPrompt").value.trim());
  localStorage.setItem("ai_streaming", $("aiStreamingToggle").checked);

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

// ═══════════════════════════════════════════════════════
// Keyboard Control Injection (WebSocket-based Real-time typing)
// ═══════════════════════════════════════════════════════
const JS_TO_ANDROID_KEY = {
  // Letters
  KeyA: 29, KeyB: 30, KeyC: 31, KeyD: 32, KeyE: 33, KeyF: 34, KeyG: 35, KeyH: 36, KeyI: 37, KeyJ: 38, KeyK: 39, KeyL: 40, KeyM: 41, KeyN: 42, KeyO: 43, KeyP: 44, KeyQ: 45, KeyR: 46, KeyS: 47, KeyT: 48, KeyU: 49, KeyV: 50, KeyW: 51, KeyX: 52, KeyY: 53, KeyZ: 54,
  // Digits
  Digit0: 7, Digit1: 8, Digit2: 9, Digit3: 10, Digit4: 11, Digit5: 12, Digit6: 13, Digit7: 14, Digit8: 15, Digit9: 16,
  // Numpad Digits & Operators
  Numpad0: 7, Numpad1: 8, Numpad2: 9, Numpad3: 10, Numpad4: 11, Numpad5: 12, Numpad6: 13, Numpad7: 14, Numpad8: 15, Numpad9: 16,
  NumpadEnter: 66, NumpadAdd: 81, NumpadSubtract: 69, NumpadMultiply: 17, NumpadDivide: 76, NumpadDecimal: 56,
  // System keys
  Enter: 66,
  Escape: 111,
  Backspace: 67,
  Tab: 61,
  Space: 62,
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
  Delete: 112,
  // Punctuation
  Minus: 69,
  Equal: 70,
  BracketLeft: 71,
  BracketRight: 72,
  Backslash: 73,
  Semicolon: 74,
  Quote: 75,
  Slash: 76,
  Comma: 55,
  Period: 56,
  // Function keys
  F1: 131, F2: 132, F3: 133, F4: 134, F5: 135, F6: 136, F7: 137, F8: 138, F9: 139, F10: 140, F11: 141, F12: 142
};

function handleGlobalKey(event, action) {
  if (!state.keyboardControlEnabled) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  // Prevent keyboard injection if user is typing in standard UI fields
  const activeEl = document.activeElement;
  if (activeEl && (
    activeEl.tagName === "INPUT" ||
    activeEl.tagName === "TEXTAREA" ||
    activeEl.tagName === "SELECT" ||
    activeEl.isContentEditable
  )) {
    return;
  }

  let androidCode = JS_TO_ANDROID_KEY[event.code];
  if (androidCode === undefined) {
    // Fallback to checking event.key for digits and operators
    if (event.key >= "0" && event.key <= "9") {
      androidCode = 7 + (event.key.charCodeAt(0) - 48); // 7 is KEYCODE_0
    } else if (event.key === "+") {
      androidCode = 81; // KEYCODE_PLUS
    } else if (event.key === "-") {
      androidCode = 69; // KEYCODE_MINUS
    } else if (event.key === "*") {
      androidCode = 17; // KEYCODE_STAR
    } else if (event.key === "/") {
      androidCode = 76; // KEYCODE_SLASH
    } else if (event.key === ".") {
      androidCode = 56; // KEYCODE_PERIOD
    } else if (event.key === "Enter") {
      androidCode = 66; // KEYCODE_ENTER
    }
  }

  if (androidCode !== undefined) {
    event.preventDefault();
    const msg = buildKeyEventMessage(action, androidCode);
    state.ws.send(msg);
  }
}

document.addEventListener("keydown", (e) => handleGlobalKey(e, SCRCPY_CONTROL.ACTION_DOWN));
document.addEventListener("keyup", (e) => handleGlobalKey(e, SCRCPY_CONTROL.ACTION_UP));

// Toggle button action handler for floating keyboard button
function toggleKeyboardControl() {
  state.keyboardControlEnabled = !state.keyboardControlEnabled;
  const btn = $("floatKeyboardBtn");
  if (state.keyboardControlEnabled) {
    btn.classList.add("active");
    log("Keyboard control enabled / 开启键盘控制");
  } else {
    btn.classList.remove("active");
    log("Keyboard control disabled / 关闭键盘控制");
  }
}
$("floatKeyboardBtn").addEventListener("click", toggleKeyboardControl);
$("floatKeyboardBtn").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  toggleKeyboardControl();
});

// A robust helper to stop and automatically restart the stream cleanly
function reconnectStream() {
  log("Restarting stream connection to apply settings... / 正在自动重新连接音视频流以应用设置...");
  if (state.ws) {
    // Preserve video dimensions so canvas pointer events remain active during reconnection
    const savedVideoWidth = state.videoWidth;
    const savedVideoHeight = state.videoHeight;
    const savedNativeWidth = state.nativeWidth;
    const savedNativeHeight = state.nativeHeight;

    // Close old WebSocket without triggering resetStream's canvas teardown
    if (state.ws) {
      state.ws.onclose = null;
      state.ws.onerror = null;
      state.ws.close();
      state.ws = null;
    }
    if (state.audioWs) {
      state.audioWs.onclose = null;
      state.audioWs.close();
      state.audioWs = null;
    }
    if (state.audioPlayer) {
      state.audioPlayer.stop();
      state.audioPlayer = null;
    }
    if (state.decoder) {
      try { state.decoder.close(); } catch (e) {}
      state.decoder = null;
    }
    state.parser = null;
    stopFpsCounter();
    stopConnectionMonitor();

    // Restore dimensions so pointer handlers keep working while reconnecting
    state.videoWidth = savedVideoWidth;
    state.videoHeight = savedVideoHeight;
    state.nativeWidth = savedNativeWidth;
    state.nativeHeight = savedNativeHeight;

    // A tiny 400ms delay to let WS close cleanly and release ports on server/client
    setTimeout(() => {
      connectStream();
    }, 400);
  } else {
    connectStream();
  }
}

// Audio toggle action handler for floating button
function toggleAudioForward() {
  state.audioForwardEnabled = !state.audioForwardEnabled;
  const btn = $("floatAudioBtn");
  const icon = $("floatAudioIcon");

  if (state.audioForwardEnabled) {
    btn.classList.add("active");
    if (icon) icon.style.color = "#00ff66";
    log("Audio forwarding enabled / 开启手机声音转发");
  } else {
    btn.classList.remove("active");
    if (icon) icon.style.color = "rgba(255,255,255,0.8)";
    log("Audio forwarding disabled / 关闭手机声音转发");
  }

  // If streaming is not active, automatically click/trigger connectStream to open screen stream (ONLY if turning audio ON!)
  if (!state.ws) {
    if (state.audioForwardEnabled) {
      let serial = $("deviceSelect").value;
      if (!serial && $("deviceSelect").options.length > 0) {
        for (let i = 0; i < $("deviceSelect").options.length; i++) {
          if ($("deviceSelect").options[i].value) {
            $("deviceSelect").value = $("deviceSelect").options[i].value;
            state.selected = $("deviceSelect").options[i].value;
            serial = state.selected;
            break;
          }
        }
      }

      if (!serial) {
        log("Error: No device selected for streaming / 错误：未检测到可用设备，无法自动串流");
        alert("请先选择一个设备！ / Please select a device first!");
        return;
      }

      log("Audio enabled offline, automatically starting stream... / 声音已开启，正在为您自动启动推流...");
      connectStream();
    }
  } else {
    // If streaming is active, dynamically restart the stream to apply the new audio setting
    log("Audio setting changed, automatically restarting stream... / 声音设置变更，正在为您自动重启音视频流...");
    reconnectStream();
  }
}
$("floatAudioBtn").addEventListener("click", toggleAudioForward);
$("floatAudioBtn").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  toggleAudioForward();
});

// Setup volume slider listener for float panel
const volSlider = $("floatVolumeSlider");
const volLabel = $("floatVolumeLabel");
if (volSlider && volLabel) {
  volSlider.addEventListener("input", () => {
    const val = Number(volSlider.value);
    volLabel.textContent = `${Math.round(val * 100)}%`;
    if (state.audioPlayer && state.audioPlayer.gainNode) {
      state.audioPlayer.gainNode.gain.value = val;
    }
  });
}

// Hover micro-interactions for slide-out volume bar
const floatAudioContainer = $("floatAudioContainer");
const floatVolumePanel = $("floatVolumePanel");
const floatAudioBtn = $("floatAudioBtn");
if (floatAudioContainer && floatVolumePanel && floatAudioBtn) {
  floatAudioContainer.addEventListener("mouseenter", () => {
    floatVolumePanel.style.width = "160px";
    floatVolumePanel.style.opacity = "1";
    floatVolumePanel.style.padding = "0 8px";
  });

  floatAudioContainer.addEventListener("mouseleave", () => {
    floatVolumePanel.style.width = "0px";
    floatVolumePanel.style.opacity = "0";
    floatVolumePanel.style.padding = "0px";
  });
}

// Screenshot action handler for floating button
$("floatScreenshotBtn").addEventListener("click", () => {
  const canvas = $("phoneCanvas");
  // If streaming is active, instantly capture from local canvas (0ms latency, zero server load)
  if (state.ws && canvas && canvas.style.display !== "none") {
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.download = `screenshot_${new Date().getTime()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      log("Screenshot captured instantly from web player / 截图成功（已直接从网页播放器捕获）");
    } catch (e) {
      log(`Canvas screenshot error: ${e.message}, falling back to ADB...`);
      triggerAdbScreenshot();
    }
  } else {
    // If not streaming, trigger ADB fallback screenshot REST API
    triggerAdbScreenshot();
  }
});

function triggerAdbScreenshot() {
  const serial = state.selected;
  if (!serial) {
    log("Error: No device selected for screenshot / 错误：未选择设备无法截图");
    alert("请先选择一个设备 / Please select a device first");
    return;
  }
  log(`Requesting device screenshot via ADB for ${serial}... / 正在通过 ADB 请求手机截图...`);
  
  // Disable button momentarily to prevent double clicks
  const btn = $("floatScreenshotBtn");
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  }

  fetch(`/api/devices/${encodeURIComponent(serial)}/screenshot`)
    .then(response => {
      if (!response.ok) throw new Error("ADB screencap failed");
      return response.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `adb_screenshot_${serial.replace(/:/g, "_")}_${new Date().getTime()}.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      log("ADB screenshot saved successfully / 手机截图成功（已通过 ADB 捕获并保存）");
    })
    .catch(err => {
      log(`Screenshot capture failed / 截图失败: ${err.message}`);
      alert(`截图失败 / Screenshot failed: ${err.message}`);
    })
    .finally(() => {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = "0.3";
      }
    });
}

// Nav Bar overlay toggle action handler for floating button
function toggleNavBar() {
  const current = localStorage.getItem("nav_bar_behavior") || "hide";
  const next = current === "show" ? "hide" : "show";
  localStorage.setItem("nav_bar_behavior", next);

  updateNavOverlayVisibility();
  updateFloatNavBtnStyle();
  log(`Navigation bottom bar behavior changed to: ${next === "show" ? "Always Show" : "Hide in non-fullscreen"} / 虚拟导航底栏显示模式已切换为：${next === "show" ? "总是显示" : "非全屏下隐藏"}`);
}
$("floatNavToggleBtn").addEventListener("click", toggleNavBar);
$("floatNavToggleBtn").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  toggleNavBar();
});

function updateFloatNavBtnStyle() {
  const btn = $("floatNavToggleBtn");
  if (!btn) return;
  const isShow = localStorage.getItem("nav_bar_behavior") === "show";
  if (isShow) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
}

// Initialize styles for floating buttons
updateFloatNavBtnStyle();

// ═══════════════════════════════════════════════════════
// AI Agent — vision-language agent loop
// ═══════════════════════════════════════════════════════

const agentState = {
  running: false,
  abortController: null,
  lastCapture: null,
};

const AGENT_STEP_BATCH = 30;
const AGENT_PLAN_STEP_LIMIT = 6;
const AGENT_DEFAULT_WAIT_MS = 2500;
const AGENT_MIN_WAIT_MS = 500;
const AGENT_MAX_WAIT_MS = 15000;

function getAgentSystemPrompt(captureInfo, mode = "act") {
  const screenW = captureInfo?.imageW || state.videoWidth || 1080;
  const screenH = captureInfo?.imageH || state.videoHeight || 1920;
  const videoW = captureInfo?.videoW || state.videoWidth || screenW;
  const videoH = captureInfo?.videoH || state.videoHeight || screenH;
  const thinkingMode = isAgentThinkingEnabled();
  const thoughtRule = thinkingMode
    ? "The JSON thought field may contain a concise visible reasoning summary in 1-3 short sentences."
    : "Keep the JSON thought field very brief, under 20 Chinese characters or 12 English words.";
  // Check for user-customized prompt
  const customPrompt = (localStorage.getItem("ai_system_prompt") || "").trim();
  const planContract = mode === "plan"
    ? `== DECISION MODE ==
You may return either a high-level plan or one immediately executable action.

Use a plan when the task needs multiple screens, app navigation, search/login/form steps, or user review before execution.
Do not use a plan for simple one-step tasks such as pressing a visible button, going back/home, typing into an already focused field, waiting for loading, or tapping a clearly visible target.
Plan format:
{"thought":"...","action":"plan","steps":[{"desc":"open the target app"},{"desc":"search for the requested item"}]}
Plan steps are goals only. Do NOT put coordinates, taps, swipes, or future-screen UI guesses inside plan steps.

If the current screen already exposes a clear single next action, return that action instead of a plan.`
    : `== ACTION MODE ==
Return exactly one executable action for the current screenshot.
Do not return a plan in this mode. Future-screen coordinates are invalid because the next screen is not visible yet.
If the current plan step is already satisfied, return done with a short summary.`;

  if (customPrompt) {
    return `${customPrompt}

You receive a downscaled screenshot of size ${screenW}x${screenH}. The live video is ${videoW}x${videoH}.
Return coordinates in the screenshot coordinate system only: x in [0,${screenW - 1}], y in [0,${screenH - 1}].
${thoughtRule}
${planContract}
Respond with ONLY a valid JSON object, no markdown wrapping.`;
  }

  return `You are an AI agent controlling a real Android phone. You see the phone screen through screenshots and control it by performing actions.

IMPORTANT COORDINATE RULE:
- The screenshot you see is ${screenW}x${screenH} pixels.
- The live video is ${videoW}x${videoH}, but you must NOT output live-video coordinates.
- Return coordinates in the screenshot image coordinate system only: x in [0,${screenW - 1}], y in [0,${screenH - 1}].
- The app will convert your screenshot coordinates to the real device/video coordinates.
- The screenshot has a labeled grid. Use the grid labels and choose the center of the visible UI element you want to press.
- For small controls, tap the visual center of the target, not the edge, label baseline, or nearby grid overlay.
- If you are unsure, prefer a "wait" or "fail" action instead of tapping a guessed location.

== YOUR CAPABILITIES ==
You can interact with the phone in these ways:
1. tap — Touch the screen at a specific coordinate. Use for clicking buttons, icons, links, menu items, toggles.
2. swipe — Drag finger from one point to another. Use for sliding, dragging, horizontal page swiping.
3. scroll — Scroll content at a position. Use for vertical scrolling through lists, pages.
4. type — Input text into a focused text field. Use after tapping a text input to focus it.
5. key — Press hardware/software keys: back, home, recent, power, enter, delete, tab, space.
6. longpress — Press and hold a point. Use only for context menus or selecting text.
7. wait — Do nothing, wait for screen to update (loading, animation, transition). Use duration_ms when the wait should be longer or shorter.

== RESPONSE FORMAT ==
You MUST respond with ONLY a valid JSON object (no markdown, no extra text):
{"thought":"...","action":"...","...params..."}
Do not use raw double quote characters inside string values. Use Chinese corner quotes or omit quotes in thought text.
${thoughtRule}

== AVAILABLE ACTIONS (with examples) ==

Simple actions (execute immediately):
  tap:     {"thought":"点击设置图标","action":"tap","x":360,"y":640}
  swipe:   {"thought":"向左滑动页面","action":"swipe","x1":600,"y1":640,"x2":120,"y2":640,"duration_ms":300}
  scroll:  {"thought":"向下滚动列表","action":"scroll","x":360,"y":640,"direction":"down"}
  type:    {"thought":"替换当前输入框内容","action":"type","text":"Hello World"}
  longpress: {"thought":"长按文本区域","action":"longpress","x":360,"y":640,"duration_ms":800}
  key:     {"thought":"按返回键","action":"key","key":"back"}
  key:     {"thought":"打开最近任务","action":"key","key":"recent"}
  wait:    {"thought":"等待页面加载","action":"wait","reason":"loading","duration_ms":3000}

Terminal actions:
  done:    {"thought":"任务已完成","action":"done","summary":"成功打开设置"}
  fail:    {"thought":"无法完成任务","action":"fail","reason":"找不到目标元素"}

Planning action, only when ${mode === "plan" ? "Decision Mode asks for it" : "explicitly allowed by the caller"}:
  plan:    {"thought":"需要先拆分任务","action":"plan","steps":[{"desc":"打开目标应用"},{"desc":"找到目标页面"}]}

${planContract}

== RULES ==
- Always provide "thought" explaining your current screen analysis and plan
- Coordinates must be within the screenshot bounds, not the full-resolution video bounds
- Tap on clearly visible UI elements (buttons, icons, text links)
- Focus a text field first (tap it), then type in the next step
- The "type" action replaces the currently focused field using clipboard paste, so use it directly after focusing the input
- Use "back" key to return to previous screen
- Use "wait" when an action triggers loading or transition
- For wait, set duration_ms between ${AGENT_MIN_WAIT_MS} and ${AGENT_MAX_WAIT_MS}; default is ${AGENT_DEFAULT_WAIT_MS}ms
- If stuck after 2 attempts, use "fail"
- When the task goal is clearly achieved, use "done"
- For complex tasks, plan first when in Decision Mode, then execute one visible-screen action at a time
- Never invent coordinates for screens you cannot currently see

need_more_steps: {"thought":"任务还没完成，需要更多步骤","action":"need_more_steps","reason":"正在逐步完成复杂任务"}`;
}

function captureFrame() {
  if (!canvas || canvas.style.display === "none") return null;
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return null;
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

// Capture frame with coordinate grid overlay for AI.
// The AI returns coordinates in this downscaled image space; we map them back
// to the live video coordinates before sending them to scrcpy.
const AI_MAX_WIDTH = 720;
function captureFrameWithGrid() {
  if (!canvas || canvas.style.display === "none") return null;
  const w = canvas.width, h = canvas.height;
  if (!w || !h) return null;

  const scale = Math.min(1, AI_MAX_WIDTH / w);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);

  const offscreen = document.createElement("canvas");
  offscreen.width = sw;
  offscreen.height = sh;
  const octx = offscreen.getContext("2d");

  octx.drawImage(canvas, 0, 0, sw, sh);

  // Grid overlay with labels in the actual image coordinate system sent to AI.
  octx.strokeStyle = "rgba(0, 255, 102, 0.45)";
  octx.lineWidth = 1;
  const fontSize = Math.max(12, Math.round(Math.min(sw, sh) * 0.022));
  octx.font = `bold ${fontSize}px monospace`;
  octx.textAlign = "left";
  octx.textBaseline = "top";

  const gridSize = Math.max(80, Math.round(Math.min(sw, sh) / 8));

  function drawLabel(text, x, y) {
    const tw = octx.measureText(text).width;
    const lh = fontSize + 4;
    octx.fillStyle = "rgba(0, 0, 0, 0.68)";
    octx.fillRect(x, y, tw + 6, lh);
    octx.fillStyle = "rgba(0, 255, 102, 0.95)";
    octx.fillText(text, x + 3, y + 2);
  }

  for (let x = gridSize; x < sw; x += gridSize) {
    octx.beginPath();
    octx.moveTo(x, 0);
    octx.lineTo(x, sh);
    octx.stroke();
    drawLabel(`x=${x}`, x + 2, 2);
  }

  for (let y = gridSize; y < sh; y += gridSize) {
    octx.beginPath();
    octx.moveTo(0, y);
    octx.lineTo(sw, y);
    octx.stroke();
    drawLabel(`y=${y}`, 2, y + 2);
  }

  // Resolution label
  octx.font = `bold ${Math.max(12, Math.round(fontSize * 0.9))}px monospace`;
  const resLabel = `AI image ${sw}x${sh}`;
  const rw = octx.measureText(resLabel).width;
  octx.fillStyle = "rgba(0, 0, 0, 0.68)";
  octx.fillRect(sw - rw - 12, sh - fontSize - 10, rw + 8, fontSize + 6);
  octx.fillStyle = "rgba(0, 255, 102, 0.95)";
  octx.fillText(resLabel, sw - rw - 8, sh - fontSize - 7);

  const dataUrl = offscreen.toDataURL("image/jpeg", 0.75);
  return {
    base64: dataUrl.split(",")[1],
    imageW: sw,
    imageH: sh,
    videoW: w,
    videoH: h,
    scale,
  };
}

// Wait until canvas has rendered content (not all-black)
async function waitForCanvasContent(maxWaitMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (canvas.width && canvas.height) {
      // Sample center pixel — if canvas has content, it won't be pure black
      const imgData = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
      if (imgData.data[3] > 0) return true; // has non-transparent content
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

// Draw a brief visual indicator on the canvas showing where the agent tapped
function drawTapIndicator(x, y) {
  const w = state.videoWidth, h = state.videoHeight;
  if (!w || !h) return;
  // Convert from video coords to canvas CSS coords for drawing
  ctx.save();
  ctx.strokeStyle = "#ff3b30";
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;
  const radius = Math.max(12, Math.min(w, h) * 0.02);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  // Crosshair
  ctx.beginPath();
  ctx.moveTo(x - radius * 1.5, y);
  ctx.lineTo(x + radius * 1.5, y);
  ctx.moveTo(x, y - radius * 1.5);
  ctx.lineTo(x, y + radius * 1.5);
  ctx.stroke();
  ctx.restore();
  // Fade out after 800ms
  setTimeout(() => { /* next frame will overwrite */ }, 800);
}

function formatPlanForPrompt(planSteps = [], currentStepIndex = -1) {
  if (!Array.isArray(planSteps) || planSteps.length === 0) return "";
  return planSteps
    .map((step, i) => {
      const marker = i === currentStepIndex ? " <- current" : "";
      return `${i + 1}. ${step.desc || String(step)}${marker}`;
    })
    .join("\n");
}

function formatAgentHistoryNote(entry) {
  const action = entry?.action || {};
  if (action.action === "wait" && Number.isFinite(Number(action.actual_wait_ms))) {
    return ` The wait action requested ${action.requested_wait_ms || action.duration_ms || "unknown"}ms and actually waited ${action.actual_wait_ms}ms.`;
  }
  return "";
}

function buildAgentCurrentInstruction(task, options = {}) {
  const mode = options.mode || "act";
  const planText = formatPlanForPrompt(options.plan || [], options.currentStepIndex);

  if (mode === "plan") {
    return `Current task: "${task}"
Here is the current screenshot.

Decide whether this task needs a user-reviewable plan.
- Return a plan if the task likely spans multiple screens or has multiple logical stages.
- Return one executable current-screen action if the best next action is visible, obvious, or the task is simple.
- Do not plan for single visible taps, back/home/recent, waiting, or typing into the current field.

OUTPUT CONTRACT: Return ONLY one minified JSON object. No prose or markdown outside JSON.
Allowed direct actions: tap, swipe, type, key, scroll, longpress, wait, done, fail.
Allowed planning action: plan.
Plan example: {"thought":"任务需要多步导航","action":"plan","steps":[{"desc":"打开设置"},{"desc":"进入网络页面"},{"desc":"检查目标开关"}]}
Direct action example: {"thought":"目标按钮已可见","action":"tap","x":360,"y":640}`;
  }

  if (mode === "plan_step") {
    return `Current task: "${task}"
Approved plan:
${planText || "(none)"}

Current plan step ${Number(options.currentStepIndex ?? 0) + 1}: "${options.currentStep?.desc || ""}"
Here is the current screenshot.

Return exactly one executable action for this current screen that advances or completes the current plan step.
If this plan step is already complete on the current screen, return {"thought":"...","action":"done","summary":"step complete"}.
Do not return plan or steps. Coordinates must be in this screenshot image's coordinate system.
For loading or animation, return wait with duration_ms, for example {"thought":"等待加载","action":"wait","reason":"loading","duration_ms":3000}.

OUTPUT CONTRACT: Return ONLY one minified JSON object. No prose or markdown outside JSON.
Allowed actions: tap, swipe, type, key, scroll, longpress, wait, done, fail.
Example: {"thought":"点击当前可见按钮","action":"tap","x":360,"y":640}`;
  }

  return `Current task: "${task}"
Here is the current screenshot. Return exactly one executable action for this current screen only.
Do not return plan or steps. Coordinates must be reported in this screenshot image's coordinate system, not the full device resolution.

OUTPUT CONTRACT: Return ONLY one minified JSON object. No analysis outside JSON. No prose outside JSON. No markdown. No text before or after the JSON.
Allowed actions: tap, swipe, type, key, scroll, longpress, wait, done, fail.
For loading or animation, return wait with duration_ms, for example {"thought":"等待加载","action":"wait","reason":"loading","duration_ms":3000}.
Example: {"thought":"brief current-screen reason","action":"swipe","x1":600,"y1":800,"x2":100,"y2":800,"duration_ms":300}`;
}

function buildAgentMessages(task, history, screenshotBase64, options = {}) {
  const messages = [];
  // Only keep last 2 history entries to avoid payload bloat
  const recent = history.slice(-2);
  for (const entry of recent) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `Step ${entry.step}: Screenshot before the recorded action.${formatAgentHistoryNote(entry)}` },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${entry.screenshot}` } },
      ],
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(entry.action),
    });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: buildAgentCurrentInstruction(task, options) },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
    ],
  });
  return messages;
}

function buildAgentMessagesAnthropic(task, history, screenshotBase64, options = {}) {
  const messages = [];
  const recent = history.slice(-2);
  for (const entry of recent) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `Step ${entry.step}: Screenshot before the recorded action.${formatAgentHistoryNote(entry)}` },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: entry.screenshot } },
      ],
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(entry.action),
    });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: buildAgentCurrentInstruction(task, options) },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: screenshotBase64 } },
    ],
  });
  return messages;
}

async function callAgentAI(systemPrompt, messages) {
  const provider = localStorage.getItem("ai_provider") || "openai";
  const endpoint = localStorage.getItem("ai_endpoint") || "";
  const api_key = localStorage.getItem("ai_key") || "";
  const model_name = localStorage.getItem("ai_model_name") || "";
  const anthropic_version = localStorage.getItem("ai_version") || "2023-06-01";
  const streaming = localStorage.getItem("ai_streaming") === "true";

  if (!api_key) throw new Error("API Key not configured. Please set it in Settings.");

  // Log payload size for debugging
  const payload = JSON.stringify({
    provider,
    endpoint,
    api_key,
    model_name,
    anthropic_version,
    system_prompt: systemPrompt,
    messages,
    stream: streaming,
  });
  console.log(`[Agent AI] payload size: ${(payload.length / 1024).toFixed(1)} KB, messages: ${messages.length}, stream: ${streaming}`);
  // Log each message's approximate image size
  messages.forEach((m, i) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    const imgMatch = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
    if (imgMatch) {
      console.log(`[Agent AI] msg[${i}] role=${m.role} image=${(imgMatch[1].length * 0.75 / 1024).toFixed(0)} KB`);
    }
  });

  if (streaming) {
    return callAgentAIStream(payload);
  }

  const res = await api("/api/ai/chat", {
    method: "POST",
    body: payload,
  });

  if (!res.ok) throw new Error(res.error || "AI request failed");
  return res.text;
}

async function callAgentAIStream(payload) {
  const response = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          // OpenAI format: choices[0].delta.content
          // DeepSeek-R1: choices[0].delta.reasoning_content
          // Anthropic format: delta.text (type: content_block_delta)
          const choice = chunk.choices?.[0]?.delta;
          let delta = choice?.content || "";
          if (!delta && choice?.reasoning_content) {
            delta = choice.reasoning_content;
          }
          if (!delta && chunk.type === "content_block_delta") {
            delta = chunk.delta?.text || "";
          }
          if (delta) {
            fullText += delta;
            // Update thought panel in real-time
            const content = $("agentThoughtContent");
            if (content) {
              let streamEl = content.querySelector(".streaming-response");
              if (!streamEl) {
                streamEl = document.createElement("div");
                streamEl.className = "streaming-response";
                streamEl.style.cssText = "padding:6px 0;border-bottom:1px solid rgba(90,200,250,0.1);";
                streamEl.innerHTML = `<div style="color:#5ac8fa;font-weight:600;margin-bottom:3px;">Streaming...</div><div class="stream-text" style="color:#9fcfe8;word-break:break-word;white-space:pre-wrap;"></div>`;
                content.appendChild(streamEl);
              }
              streamEl.querySelector(".stream-text").textContent = fullText;
              content.scrollTop = content.scrollHeight;
            }
          }
        } catch (e) {
          // ignore parse errors for non-JSON lines
        }
      }
    }
  }

  console.log(`[Agent AI] stream complete: ${fullText.length} chars`);
  // Remove streaming indicator from thought panel
  const streamEl = $("agentThoughtContent")?.querySelector(".streaming-response");
  if (streamEl) {
    const label = streamEl.querySelector("div:first-child");
    if (label) label.textContent = fullText.length > 0 ? "Streamed" : "Empty response";
  }
  return fullText;
}

function parseAgentAction(text) {
  // Try to extract JSON from the response (handle potential markdown wrapping)
  let jsonStr = text.trim();
  // Remove markdown code block if present
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  // Try to find JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    const repaired = parseLooseAgentAction(jsonStr);
    if (repaired) return repaired;
    throw err;
  }
}

function parseLooseAgentAction(text) {
  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  if (!actionMatch) return null;

  const action = { action: actionMatch[1] };
  const beforeAction = text.slice(0, actionMatch.index);
  const thoughtMatch = beforeAction.match(/"thought"\s*:\s*([\s\S]*)$/);
  if (thoughtMatch) {
    action.thought = thoughtMatch[1]
      .trim()
      .replace(/^"/, "")
      .replace(/",?\s*$/, "")
      .replace(/\\"/g, "\"");
  }

  const stringFields = ["direction", "key", "text", "reason", "summary", "desc"];
  for (const field of stringFields) {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`));
    if (match) action[field] = match[1];
  }

  const numericFields = ["x", "y", "x1", "y1", "x2", "y2", "duration_ms", "duration", "seconds", "ms"];
  for (const field of numericFields) {
    const match = text.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
    if (match) action[field] = Number(match[1]);
  }

  return action;
}

function inferActionFromText(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const thought = raw.length > 180 ? `${raw.slice(0, 180)}...` : raw;

  if (/等待|加载|稍等|wait/.test(lower)) {
    return { thought, action: "wait", reason: "inferred from non-JSON response" };
  }

  if (/任务(已经|已|)完成|操作(已经|已|)完成|已经完成|已完成|成功发布|评论已发送|liked and commented|task complete|task completed/.test(lower)) {
    return { thought, action: "done", summary: "inferred from non-JSON response" };
  }

  if (/返回|back/.test(lower)) {
    return { thought, action: "key", key: "back" };
  }

  if (/主页|home/.test(lower) && /按|回到|返回/.test(lower)) {
    return { thought, action: "key", key: "home" };
  }

  if (/向左|左滑|滑动到其他|其他桌面|下一屏|swipe left/.test(lower)) {
    return { thought, action: "swipe", x1: 600, y1: 800, x2: 100, y2: 800, duration_ms: 300 };
  }

  if (/向右|右滑|上一屏|swipe right/.test(lower)) {
    return { thought, action: "swipe", x1: 100, y1: 800, x2: 600, y2: 800, duration_ms: 300 };
  }

  if (/向下|下滑|继续往下|scroll down/.test(lower)) {
    return { thought, action: "scroll", x: 360, y: 800, direction: "down" };
  }

  if (/向上|上滑|scroll up/.test(lower)) {
    return { thought, action: "scroll", x: 360, y: 800, direction: "up" };
  }

  const coord = lower.match(/x\s*[=:：]\s*(\d+)[,\s，]+y\s*[=:：]\s*(\d+)/);
  if ((/点击|tap|打开/.test(lower)) && coord) {
    return { thought, action: "tap", x: Number(coord[1]), y: Number(coord[2]) };
  }

  return null;
}

async function repairAgentActionWithAI(aiText, task, provider) {
  const repairMessages = [{
    role: "user",
    content: `Convert this invalid agent response into exactly one minified JSON action for the current screen. Do not add prose. Do not return plan or steps.\nTask: ${task}\nAllowed actions: tap, swipe, type, key, scroll, longpress, wait, done, fail.\nInvalid response:\n${aiText.slice(0, 3000)}`,
  }];
  const repairPrompt = "You are a strict JSON formatter for an Android control agent. Return only one valid JSON object.";
  const repairedText = await callAgentAI(repairPrompt, repairMessages);
  console.log(`[Agent] repair response (${repairedText.length} chars):`, repairedText.substring(0, 500));
  return parseAgentAction(repairedText);
}

async function repairAgentDecisionWithAI(aiText, task) {
  const repairMessages = [{
    role: "user",
    content: `Convert this invalid planner response into exactly one minified JSON object. Do not add prose.
Task: ${task}
Allowed outputs:
1. {"thought":"...","action":"plan","steps":[{"desc":"goal only"},{"desc":"goal only"}]}
2. One current-screen action: tap, swipe, type, key, scroll, longpress, wait, done, fail.
Plan steps must be high-level goals only; remove coordinates and future-screen gestures.
Invalid response:
${aiText.slice(0, 3000)}`,
  }];
  const repairPrompt = "You are a strict JSON formatter for an Android planning agent. Return only one valid JSON object.";
  const repairedText = await callAgentAI(repairPrompt, repairMessages);
  console.log(`[Agent] planner repair response (${repairedText.length} chars):`, repairedText.substring(0, 500));
  return parseAgentAction(repairedText);
}

function normalizeAgentPlanSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => {
      if (typeof step === "string") return { desc: step.trim() };
      if (!step || typeof step !== "object") return null;
      const desc = String(step.desc || step.goal || step.title || step.action || "").trim();
      return desc ? { desc } : null;
    })
    .filter(Boolean)
    .slice(0, 12);
}

function buildAgentMessagesForProvider(provider, task, history, screenshotBase64, options = {}) {
  const imageFormat = localStorage.getItem("ai_image_format") || "auto";
  const useAnthropicFormat = imageFormat === "base64" || (imageFormat === "auto" && provider === "anthropic");
  return useAnthropicFormat
    ? buildAgentMessagesAnthropic(task, history, screenshotBase64, options)
    : buildAgentMessages(task, history, screenshotBase64, options);
}

async function captureAgentObservation(statusText = "") {
  const statusEl = $("agentStatus");
  if (statusEl && statusText) statusEl.textContent = statusText;
  const capture = captureFrameWithGrid();
  if (!capture) throw new Error("failed to capture frame");
  agentState.lastCapture = capture;
  return capture;
}

async function requestAgentDecision(task, history, capture, options = {}) {
  const provider = localStorage.getItem("ai_provider") || "openai";
  const mode = options.mode || "act";
  const systemPrompt = getAgentSystemPrompt(capture, mode);
  console.log(`[Agent] ${mode} system prompt (${systemPrompt.length} chars):`, systemPrompt.substring(0, 300) + "...");
  const messages = buildAgentMessagesForProvider(provider, task, history, capture.base64, options);

  let aiText;
  try {
    aiText = await callAgentAI(systemPrompt, messages);
  } catch (err) {
    throw new Error(`AI error: ${err.message}`);
  }
  aiText = String(aiText || "");

  console.log(`[Agent] ${mode} AI response (${aiText.length} chars):`, aiText.substring(0, 500));
  if (isAgentThinkingEnabled() && aiText && !aiText.trim().startsWith("{")) {
    addAgentThought(options.stepNumber || "?", "模型原始输出", aiText.slice(0, 1200));
  }

  if (!aiText || !aiText.trim()) {
    const wasStream = localStorage.getItem("ai_streaming") === "true";
    console.warn(`[Agent] ${mode} got empty response (stream=${wasStream}), retrying...`);
    await new Promise(r => setTimeout(r, 1200));
    try {
      if (wasStream) {
        localStorage.setItem("ai_streaming", "false");
        aiText = await callAgentAI(systemPrompt, messages);
        localStorage.setItem("ai_streaming", "true");
      } else {
        aiText = await callAgentAI(systemPrompt, messages);
      }
    } catch (err) {
      if (wasStream) localStorage.setItem("ai_streaming", "true");
      throw new Error(`AI retry error: ${err.message}`);
    }
    if (!aiText || !aiText.trim()) throw new Error("AI returned empty response");
  }

  let action;
  try {
    action = parseAgentAction(aiText);
  } catch (err) {
    if (mode === "plan") {
      log("Agent: planner returned non-JSON, trying format repair...");
      try {
        action = await repairAgentDecisionWithAI(aiText, task);
      } catch (repairErr) {
        throw new Error(`failed to parse planner response: ${aiText.substring(0, 200)}`);
      }
    } else {
      log("Agent: AI returned non-JSON, trying format repair...");
      addAgentThought(options.stepNumber || "?", "格式修正", "模型没有返回可执行 JSON，正在请求它压缩成一个当前屏幕动作。");
      try {
        action = await repairAgentActionWithAI(aiText, task, provider);
      } catch (repairErr) {
        const inferred = inferActionFromText(aiText);
        if (!inferred) throw new Error(`failed to parse AI response: ${aiText.substring(0, 200)}`);
        log(`Agent: inferred fallback action "${inferred.action}" from non-JSON response`);
        action = inferred;
      }
    }
  }

  if (action.action === "plan") {
    action.steps = normalizeAgentPlanSteps(action.steps);
    action.desc = action.desc || `${action.steps.length} steps`;
  }
  console.log(`[Agent] ${mode} parsed action:`, JSON.stringify(action));
  return action;
}

async function askForMoreAgentSteps(currentMax) {
  log(`Agent: reached ${currentMax} steps, asking user for more...`);
  const statusEl = $("agentStatus");
  if (statusEl) statusEl.textContent = "等待用户确认...";
  return new Promise(resolve => {
    setTimeout(() => resolve(confirm(`Agent 已执行 ${currentMax} 步，任务尚未完成。\n\n是否继续执行更多步骤？`)), 50);
  });
}

async function runAgentActionStep(task, history, counters, options = {}) {
  if (counters.step >= counters.maxSteps) {
    const more = await askForMoreAgentSteps(counters.maxSteps);
    if (more && agentState.running) {
      counters.maxSteps += AGENT_STEP_BATCH;
      log(`Agent: user approved, extending to ${counters.maxSteps} steps`);
    } else {
      log(`Agent: user declined or stopped at ${counters.maxSteps} steps`);
      return "stop";
    }
  }

  counters.step++;
  const statusText = options.statusText || `Step ${counters.step}/${counters.maxSteps}...`;
  const capture = await captureAgentObservation(statusText);
  const action = await requestAgentDecision(task, history, capture, {
    ...options,
    mode: options.mode || "act",
    stepNumber: counters.step,
  });
  if (action.action === "wait") {
    action.duration_ms = getAgentWaitMs(action);
  }

  addAgentThought(counters.step, "动作理由", action.thought || action.reason || action.summary || "");
  addAgentLog(counters.step, action.thought, action, capture.base64);

  if (action.action === "done") {
    log(`Agent: ${options.mode === "plan_step" ? "plan step completed" : "task completed"} — ${action.summary || ""}`);
    history.push({ step: counters.step, screenshot: capture.base64, action });
    return "done";
  }
  if (action.action === "fail") {
    log(`Agent: ${options.mode === "plan_step" ? "plan step failed" : "task failed"} — ${action.reason || ""}`);
    history.push({ step: counters.step, screenshot: capture.base64, action });
    return "fail";
  }
  if (action.action === "need_more_steps") {
    log(`Agent: requesting more steps — ${action.reason || ""}`);
    const more = confirm(`Agent 请求更多步骤：${action.reason || "任务尚未完成"}\n\n是否批准？`);
    if (more && agentState.running) {
      counters.maxSteps += AGENT_STEP_BATCH;
      log(`Agent: user approved, extending to ${counters.maxSteps} steps`);
      history.push({ step: counters.step, screenshot: capture.base64, action });
      return "continue";
    }
    log("Agent: user declined, stopping");
    return "stop";
  }
  if (action.action === "plan") {
    if ((options.mode || "act") !== "plan_step" && action.steps.length > 0) {
      log(`Agent: proposed ${action.steps.length} plan steps during execution`);
      const approvedSteps = await showPlanPanel(action.steps, action.thought);
      if (!approvedSteps || approvedSteps.length === 0) {
        log("Agent: plan cancelled");
        return "stop";
      }
      const normalizedSteps = normalizeAgentPlanSteps(approvedSteps);
      const planResult = await executePlan(task, normalizedSteps, history, counters);
      return planResult === "fail" || planResult === "stop" ? planResult : "continue";
    }

    log("Agent: nested plan ignored inside a plan step; requesting a current-screen action next");
    history.push({
      step: counters.step,
      screenshot: capture.base64,
      action: { action: "wait", reason: "Nested plan returned inside a plan step; re-observe current screen." },
    });
    await agentSleep(500);
    return "continue";
  }

  let executionResult = {};
  try {
    executionResult = await executeAgentAction(action) || {};
  } catch (err) {
    log(`Agent: action execution error: ${err.message}`);
  }
  history.push({ step: counters.step, screenshot: capture.base64, action: actionWithExecutionResult(action, executionResult) });
  await agentSleep(1000);
  return "continue";
}

function addAgentLog(step, thought, action, screenshotBase64) {
  const logEl = $("agentLog");
  if (!logEl) return;

  const actionColors = {
    tap: "#00ff66",
    swipe: "#5ac8fa",
    type: "#ffcc02",
    key: "#ff9500",
    scroll: "#5ac8fa",
    longpress: "#af52de",
    wait: "#8e8e93",
    done: "#00ff66",
    fail: "#ff3b30",
    plan: "#f0b35a",
  };
  const color = actionColors[action.action] || "#aab2b9";

  let actionDesc = action.action;
  if (action.action === "tap") actionDesc = `tap (${action.x}, ${action.y})`;
  else if (action.action === "swipe") actionDesc = `swipe (${action.x1},${action.y1}) → (${action.x2},${action.y2})`;
  else if (action.action === "type") actionDesc = `type "${action.text}"`;
  else if (action.action === "key") actionDesc = `key [${action.key}]`;
  else if (action.action === "scroll") actionDesc = `scroll ${action.direction} at (${action.x},${action.y})`;
  else if (action.action === "longpress") actionDesc = `longpress (${action.x}, ${action.y})`;
  else if (action.action === "wait") actionDesc = `wait ${action.duration_ms || action.requested_wait_ms || AGENT_DEFAULT_WAIT_MS}ms: ${action.reason || ""}`;
  else if (action.action === "done") actionDesc = `done: ${action.summary || ""}`;
  else if (action.action === "need_more_steps") actionDesc = `need_more_steps: ${action.reason || ""}`;
  else if (action.action === "fail") actionDesc = `fail: ${action.reason || ""}`;
  else if (action.action === "plan") actionDesc = `plan (${action.desc || "steps"})`;

  const item = document.createElement("div");
  item.style.cssText = "display:flex;gap:6px;align-items:flex-start;font-size:11px;padding:4px;border-radius:4px;background:rgba(255,255,255,0.02);";

  let thumbHtml = "";
  if (screenshotBase64) {
    thumbHtml = `<img src="data:image/jpeg;base64,${screenshotBase64}" style="width:48px;height:auto;border-radius:3px;flex-shrink:0;opacity:0.8;" />`;
  }

  item.innerHTML = `
    ${thumbHtml}
    <div style="min-width:0;flex:1;">
      <div style="color:${color};font-weight:600;margin-bottom:2px;">#${step} ${actionDesc}</div>
      <div style="color:#8a949d;line-height:1.3;word-break:break-word;">${thought || ""}</div>
    </div>
  `;

  logEl.appendChild(item);
  logEl.scrollTop = logEl.scrollHeight;
}

function isAgentThinkingEnabled() {
  const toggle = $("agentThinkingToggle");
  if (toggle) return toggle.checked;
  return localStorage.getItem("agent_thinking_enabled") === "true";
}

function setAgentThoughtPanelVisible(visible) {
  const panel = $("agentThoughtPanel");
  if (!panel) return;
  panel.style.display = visible ? "flex" : "none";
}

function clearAgentThoughts() {
  const content = $("agentThoughtContent");
  if (content) content.innerHTML = "";
  const status = $("agentThoughtStatus");
  if (status) status.textContent = "";
}

function addAgentThought(step, title, text) {
  if (!isAgentThinkingEnabled()) return;
  const content = $("agentThoughtContent");
  if (!content || !text) return;

  const status = $("agentThoughtStatus");
  if (status) status.textContent = `Step ${step}`;

  const item = document.createElement("div");
  item.style.cssText = "padding:6px 0;border-bottom:1px solid rgba(90,200,250,0.1);";
  const clean = String(text).trim();
  item.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;">
      <span style="color:#5ac8fa;font-weight:600;">#${step} ${escapeHtml(title || "思考")}</span>
    </div>
    <div style="color:#9fcfe8;word-break:break-word;white-space:pre-wrap;">${escapeHtml(clean)}</div>
  `;
  content.appendChild(item);
  content.scrollTop = content.scrollHeight;
}

function clampNumber(value, min, max, fallback = min) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.max(min, Math.min(max, num)));
}

function getAgentWaitMs(action = {}) {
  const raw = action.duration_ms ?? action.ms ?? action.duration;
  let waitMs = Number(raw);
  if (!Number.isFinite(waitMs) && Number.isFinite(Number(action.seconds))) {
    waitMs = Number(action.seconds) * 1000;
  }
  if (!Number.isFinite(waitMs) || waitMs <= 0) waitMs = AGENT_DEFAULT_WAIT_MS;
  return clampNumber(waitMs, AGENT_MIN_WAIT_MS, AGENT_MAX_WAIT_MS, AGENT_DEFAULT_WAIT_MS);
}

async function agentSleep(ms) {
  const startedAt = performance.now();
  const deadline = startedAt + ms;
  while (agentState.running && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(100, deadline - performance.now())));
  }
  return Math.round(performance.now() - startedAt);
}

function actionWithExecutionResult(action, result = {}) {
  if (!result || Object.keys(result).length === 0) return action;
  return {
    ...action,
    ...result,
  };
}

function agentPointToVideo(x, y, captureInfo = agentState.lastCapture) {
  const videoW = captureInfo?.videoW || state.videoWidth || 1080;
  const videoH = captureInfo?.videoH || state.videoHeight || 1920;
  const imageW = captureInfo?.imageW || videoW;
  const imageH = captureInfo?.imageH || videoH;
  const rawX = Number(x);
  const rawY = Number(y);

  // Backward compatibility: older prompts asked for full video coordinates.
  // If a point clearly exceeds the AI image bounds but fits the video bounds,
  // treat it as already being in video space.
  if (
    Number.isFinite(rawX) &&
    Number.isFinite(rawY) &&
    (rawX > imageW - 1 || rawY > imageH - 1) &&
    rawX >= 0 && rawX < videoW &&
    rawY >= 0 && rawY < videoH
  ) {
    return {
      x: clampNumber(rawX, 0, videoW - 1, videoW / 2),
      y: clampNumber(rawY, 0, videoH - 1, videoH / 2),
      imageX: clampNumber((rawX / videoW) * imageW, 0, imageW - 1, imageW / 2),
      imageY: clampNumber((rawY / videoH) * imageH, 0, imageH - 1, imageH / 2),
      imageW,
      imageH,
      videoW,
      videoH,
    };
  }

  const ix = clampNumber(rawX, 0, imageW - 1, imageW / 2);
  const iy = clampNumber(rawY, 0, imageH - 1, imageH / 2);

  return {
    x: clampNumber((ix / imageW) * videoW, 0, videoW - 1, videoW / 2),
    y: clampNumber((iy / imageH) * videoH, 0, videoH - 1, videoH / 2),
    imageX: ix,
    imageY: iy,
    imageW,
    imageH,
    videoW,
    videoH,
  };
}

function videoPointToNative(x, y, videoW, videoH) {
  let nativeW = state.nativeWidth || videoW;
  let nativeH = state.nativeHeight || videoH;
  const videoIsLandscape = videoW > videoH;
  const nativeIsLandscape = nativeW > nativeH;
  if (videoIsLandscape !== nativeIsLandscape) {
    [nativeW, nativeH] = [nativeH, nativeW];
  }
  return {
    x: clampNumber((x / videoW) * nativeW, 0, nativeW - 1, nativeW / 2),
    y: clampNumber((y / videoH) * nativeH, 0, nativeH - 1, nativeH / 2),
  };
}

async function performVideoSwipe(start, end, durationMs = 320) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendTouch(SCRCPY_CONTROL.ACTION_DOWN, start.x, start.y, SCRCPY_CONTROL.MAX_PRESSURE, SCRCPY_CONTROL.BUTTON_PRIMARY);
    const steps = 12;
    const stepDelay = durationMs / steps;
    for (let i = 1; i <= steps; i++) {
    await agentSleep(stepDelay);
      const cx = Math.round(start.x + (end.x - start.x) * (i / steps));
      const cy = Math.round(start.y + (end.y - start.y) * (i / steps));
      sendTouch(SCRCPY_CONTROL.ACTION_MOVE, cx, cy, SCRCPY_CONTROL.MAX_PRESSURE, SCRCPY_CONTROL.BUTTON_PRIMARY);
    }
    await agentSleep(60);
    sendTouch(SCRCPY_CONTROL.ACTION_UP, end.x, end.y, 0, SCRCPY_CONTROL.BUTTON_PRIMARY);
  } else {
    const nativeStart = videoPointToNative(start.x, start.y, start.videoW, start.videoH);
    const nativeEnd = videoPointToNative(end.x, end.y, end.videoW, end.videoH);
    await sendSwipe(nativeStart, nativeEnd, durationMs);
  }
}

async function sendKeyPress(keycode, metaState = 0, holdMs = 50) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(buildKeyEventMessage(SCRCPY_CONTROL.ACTION_DOWN, keycode, metaState));
    await new Promise((r) => setTimeout(r, holdMs));
    state.ws.send(buildKeyEventMessage(SCRCPY_CONTROL.ACTION_UP, keycode, metaState));
  } else {
    const serial = $("deviceSelect").value;
    await api(`/api/devices/${encodeURIComponent(serial)}/keyevent`, {
      method: "POST",
      body: JSON.stringify({ key: keycode }),
    });
  }
}

async function replaceFocusedText(text) {
  const value = String(text ?? "");
  if (!value) return;

  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    // Replace existing field content first. Android text fields usually honor
    // Ctrl+A from a hardware/scrcpy keyboard event, then DEL clears it.
    await sendKeyPress(SCRCPY_CONTROL.KEYCODE_A, SCRCPY_CONTROL.META_CTRL_ON, 80);
    await new Promise((r) => setTimeout(r, 80));
    await sendKeyPress(SCRCPY_CONTROL.KEYCODE_DEL, 0, 60);
    await new Promise((r) => setTimeout(r, 80));
    state.ws.send(buildSetClipboardMessage(value, true));
    log(`Agent paste text via clipboard: "${value}"`);
    return;
  }

  const serial = $("deviceSelect").value;
  await api(`/api/devices/${encodeURIComponent(serial)}/text`, {
    method: "POST",
    body: JSON.stringify({ text: value }),
  });
}

async function executeAgentAction(action) {
  const captureInfo = agentState.lastCapture;

  switch (action.action) {
    case "tap": {
      const pt = agentPointToVideo(action.x, action.y, captureInfo);
      log(`Agent tap: image(${pt.imageX}, ${pt.imageY}) → video(${pt.x}, ${pt.y})`);
      console.log(`[Agent] tap image=${pt.imageX},${pt.imageY}/${pt.imageW}x${pt.imageH} video=${pt.x},${pt.y}/${pt.videoW}x${pt.videoH} native=${state.nativeWidth}x${state.nativeHeight}`);
      drawTapIndicator(pt.x, pt.y);
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendTouch(SCRCPY_CONTROL.ACTION_DOWN, pt.x, pt.y, SCRCPY_CONTROL.MAX_PRESSURE, SCRCPY_CONTROL.BUTTON_PRIMARY);
        await new Promise((r) => setTimeout(r, 80));
        sendTouch(SCRCPY_CONTROL.ACTION_UP, pt.x, pt.y, 0, SCRCPY_CONTROL.BUTTON_PRIMARY);
        console.log(`[Agent] WS touch sent at (${pt.x}, ${pt.y})`);
      } else {
        const native = videoPointToNative(pt.x, pt.y, pt.videoW, pt.videoH);
        console.log(`[Agent] WS not open, adb tap(${native.x}, ${native.y})`);
        await sendTap(native);
      }
      await agentSleep(500);
      break;
    }
    case "swipe": {
      const start = agentPointToVideo(action.x1, action.y1, captureInfo);
      const end = agentPointToVideo(action.x2, action.y2, captureInfo);
      log(`Agent swipe: image(${start.imageX},${start.imageY})→(${end.imageX},${end.imageY}) video(${start.x},${start.y})→(${end.x},${end.y})`);
      await performVideoSwipe(start, end, action.duration_ms || 300);
      await agentSleep(500);
      break;
    }
    case "longpress": {
      const pt = agentPointToVideo(action.x, action.y, captureInfo);
      const duration = Math.max(300, Number(action.duration_ms) || 800);
      log(`Agent longpress: image(${pt.imageX}, ${pt.imageY}) → video(${pt.x}, ${pt.y})`);
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendTouch(SCRCPY_CONTROL.ACTION_DOWN, pt.x, pt.y, SCRCPY_CONTROL.MAX_PRESSURE, SCRCPY_CONTROL.BUTTON_PRIMARY);
        await new Promise((r) => setTimeout(r, duration));
        sendTouch(SCRCPY_CONTROL.ACTION_UP, pt.x, pt.y, 0, SCRCPY_CONTROL.BUTTON_PRIMARY);
      } else {
        const native = videoPointToNative(pt.x, pt.y, pt.videoW, pt.videoH);
        await sendSwipe(native, native, duration);
      }
      await agentSleep(500);
      break;
    }
    case "type": {
      await replaceFocusedText(action.text);
      await agentSleep(500);
      break;
    }
    case "key": {
      const keyMap = {
        back: SCRCPY_CONTROL.KEYCODE_BACK,
        home: SCRCPY_CONTROL.KEYCODE_HOME,
        power: SCRCPY_CONTROL.KEYCODE_POWER,
        recent: SCRCPY_CONTROL.KEYCODE_APP_SWITCH,
        app_switch: SCRCPY_CONTROL.KEYCODE_APP_SWITCH,
        enter: 66,
        delete: 67,
        del: 67,
        tab: 61,
        space: 62,
      };
      const keycode = keyMap[(action.key || "").toLowerCase()] || action.key;
      await sendKeyPress(keycode);
      await agentSleep(300);
      break;
    }
    case "scroll": {
      const imageW = captureInfo?.imageW || state.videoWidth || 1080;
      const imageH = captureInfo?.imageH || state.videoHeight || 1920;
      const pt = agentPointToVideo(
        action.x ?? imageW / 2,
        action.y ?? imageH / 2,
        captureInfo
      );
      const dir = (action.direction || "down").toLowerCase();
      const marginX = Math.max(80, Math.round(pt.videoW * 0.12));
      const marginY = Math.max(160, Math.round(pt.videoH * 0.16));
      const travelX = Math.max(180, Math.round(pt.videoW * 0.45));
      const travelY = Math.max(420, Math.round(pt.videoH * 0.42));
      const cx = clampNumber(pt.x, marginX, pt.videoW - marginX - 1, pt.videoW / 2);
      const cy = clampNumber(pt.y, marginY, pt.videoH - marginY - 1, pt.videoH / 2);
      const start = { ...pt, x: cx, y: cy };
      const end = { ...pt, x: cx, y: cy };

      if (dir === "down") {
        end.y = clampNumber(cy - travelY, marginY, pt.videoH - marginY - 1, cy - travelY);
      } else if (dir === "up") {
        end.y = clampNumber(cy + travelY, marginY, pt.videoH - marginY - 1, cy + travelY);
      } else if (dir === "right") {
        end.x = clampNumber(cx - travelX, marginX, pt.videoW - marginX - 1, cx - travelX);
      } else if (dir === "left") {
        end.x = clampNumber(cx + travelX, marginX, pt.videoW - marginX - 1, cx + travelX);
      }

      log(`Agent scroll ${dir}: swipe video(${start.x},${start.y})→(${end.x},${end.y})`);
      await performVideoSwipe(start, end, action.duration_ms || 420);
      await agentSleep(700);
      break;
    }
    case "wait": {
      const requestedWaitMs = getAgentWaitMs(action);
      const startedAt = new Date();
      log(`Agent wait: ${requestedWaitMs}ms${action.reason ? ` (${action.reason})` : ""}`);
      const actualWaitMs = await agentSleep(requestedWaitMs);
      const endedAt = new Date();
      log(`Agent wait finished: ${actualWaitMs}ms`);
      return {
        requested_wait_ms: requestedWaitMs,
        actual_wait_ms: actualWaitMs,
        wait_started_at: startedAt.toISOString(),
        wait_ended_at: endedAt.toISOString(),
      };
    }
    case "done":
    case "fail":
      break;
    case "need_more_steps":
      break;
  }
  return {};
}

// ═══════════════════════════════════════════════════════
// Plan Panel — shows execution plan for user review
// ═══════════════════════════════════════════════════════

let planResolve = null; // resolves with steps array or null (cancelled)

function showPlanPanel(steps, thought) {
  return new Promise((resolve) => {
    planResolve = resolve;
    const panel = $("planPanel");
    const thoughtEl = $("planThought");
    const stepsEl = $("planSteps");
    const statusEl = $("agentStatus");
    if (!panel || !thoughtEl || !stepsEl) {
      log("Agent: plan panel DOM is missing");
      planResolve = null;
      resolve(null);
      return;
    }
    if (statusEl) statusEl.textContent = "Plan review";

    // Show thought
    thoughtEl.textContent = thought || "Execution plan";

    // Render steps
    renderPlanSteps(steps);

    // Show panel with animation. Fixed positioning keeps it visible even when
    // the stream container is transformed or clipped.
    panel.style.position = "fixed";
    panel.style.top = "92px";
    panel.style.right = "24px";
    panel.style.width = "360px";
    panel.style.maxWidth = "calc(100vw - 48px)";
    panel.style.maxHeight = "calc(100vh - 116px)";
    panel.style.zIndex = "1200";
    panel.style.pointerEvents = "auto";
    panel.style.visibility = "visible";
    panel.style.display = "flex";
    panel.style.opacity = "0";
    panel.style.transform = "translateY(-8px)";
    requestAnimationFrame(() => {
      panel.style.transition = "opacity 0.22s ease, transform 0.22s cubic-bezier(0.4,0,0.2,1)";
      panel.style.opacity = "1";
      panel.style.transform = "translateY(0)";
    });

    // Animate canvas to the left
    const phoneCanvas = $("phoneCanvas");
    if (phoneCanvas) {
      phoneCanvas.style.transition = "transform 0.4s cubic-bezier(0.4,0,0.2,1)";
      phoneCanvas.style.transform = "translateX(-180px)";
    }

    // Hide agent panel while plan is showing
    const agentPanel = $("agentPanel");
    if (agentPanel) agentPanel.style.display = "none";
  });
}

function renderPlanSteps(steps) {
  const stepsEl = $("planSteps");
  stepsEl.innerHTML = "";
  steps.forEach((step, i) => {
    const div = document.createElement("div");
    div.className = "plan-step";
    div.dataset.index = i;
    div.innerHTML = `
      <span class="step-num">${i + 1}</span>
      <textarea class="step-desc" rows="1" spellcheck="false">${escapeHtml(step.desc || "")}</textarea>
      <span class="step-action-tag">goal</span>
      <button class="step-delete" title="Delete step">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    `;
    // Auto-resize textarea
    const textarea = div.querySelector(".step-desc");
    textarea.addEventListener("input", () => {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
      // Update step desc in data
      const idx = parseInt(div.dataset.index);
      steps[idx].desc = textarea.value;
    });
    // Delete button
    div.querySelector(".step-delete").addEventListener("click", () => {
      const idx = parseInt(div.dataset.index);
      steps.splice(idx, 1);
      renderPlanSteps(steps);
    });
    stepsEl.appendChild(div);
    // Trigger initial resize
    requestAnimationFrame(() => {
      textarea.style.height = "auto";
      textarea.style.height = textarea.scrollHeight + "px";
    });
  });
  // Store steps reference for later retrieval
  stepsEl._steps = steps;
}

function hidePlanPanel() {
  const panel = $("planPanel");
  if (!panel) return;
  panel.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  panel.style.opacity = "0";
  panel.style.transform = "translateY(-8px)";
  setTimeout(() => {
    panel.style.display = "none";
    panel.style.visibility = "hidden";
  }, 260);

  // Restore canvas position
  const phoneCanvas = $("phoneCanvas");
  if (phoneCanvas) {
    phoneCanvas.style.transition = "transform 0.4s cubic-bezier(0.4,0,0.2,1)";
    phoneCanvas.style.transform = "translateX(0)";
  }

  // Show agent panel again
  const agentPanel = $("agentPanel");
  if (agentPanel) agentPanel.style.display = "flex";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Collect current steps from the DOM (user may have edited)
function getPlanSteps() {
  const stepsEl = $("planSteps");
  const items = stepsEl.querySelectorAll(".plan-step");
  const steps = [];
  items.forEach((item, i) => {
    const desc = item.querySelector(".step-desc").value;
    // Find the original step data
    const origSteps = stepsEl._steps || [];
    const orig = origSteps[i] || {};
    steps.push({ ...orig, desc });
  });
  return steps;
}

async function executePlan(task, steps, history, counters) {
  for (let i = 0; i < steps.length; i++) {
    if (!agentState.running) break;

    // Highlight current step in UI
    const stepEls = $("planSteps").querySelectorAll(".plan-step");
    stepEls.forEach((el, j) => {
      el.classList.toggle("executing", j === i);
      if (j === i) {
        el.querySelector(".step-num").textContent = "▶";
      }
    });

    const step = steps[i];
    log(`Agent plan step ${i + 1}/${steps.length}: ${step.desc}`);

    let stepDone = false;
    for (let attempt = 1; attempt <= AGENT_PLAN_STEP_LIMIT && agentState.running; attempt++) {
      const result = await runAgentActionStep(task, history, counters, {
        mode: "plan_step",
        plan: steps,
        currentStep: step,
        currentStepIndex: i,
        statusText: `Plan ${i + 1}/${steps.length}, try ${attempt}/${AGENT_PLAN_STEP_LIMIT}...`,
      });

      if (result === "done") {
        stepDone = true;
        break;
      }
      if (result === "fail" || result === "stop") {
        return result;
      }
    }

    if (!stepDone) {
      log(`Agent: plan step ${i + 1} reached retry limit, moving to next step`);
    }

    await agentSleep(800);
  }

  return "done";
}

// Plan panel button handlers
$("planConfirmBtn").addEventListener("click", () => {
  if (planResolve) {
    const steps = getPlanSteps();
    const resolve = planResolve;
    planResolve = null;
    hidePlanPanel();
    resolve(steps);
  }
});

$("planCancelBtn").addEventListener("click", () => {
  if (planResolve) {
    const resolve = planResolve;
    planResolve = null;
    hidePlanPanel();
    resolve(null); // null = cancelled
  }
});

$("planCloseBtn").addEventListener("click", () => {
  if (planResolve) {
    const resolve = planResolve;
    planResolve = null;
    hidePlanPanel();
    resolve(null);
  }
});

$("planAddStepBtn").addEventListener("click", () => {
  const stepsEl = $("planSteps");
  const steps = stepsEl._steps || [];
  steps.push({ desc: "New step" });
  renderPlanSteps(steps);
  // Focus the new step's textarea
  const newTextareas = stepsEl.querySelectorAll(".step-desc");
  const last = newTextareas[newTextareas.length - 1];
  if (last) { last.focus(); last.select(); }
});

async function agentLoop(task) {
  if (agentState.running) return;
  if (!task.trim()) {
    log("Agent: please enter a task / 请输入任务");
    return;
  }
  if (!state.videoWidth) {
    log("Agent: no active stream / 请先开始投屏");
    return;
  }

  const api_key = localStorage.getItem("ai_key") || "";
  if (!api_key) {
    log("Agent: API Key not configured / 请先配置 AI API Key");
    return;
  }

  agentState.running = true;
  agentState.abortController = new AbortController();
  const startBtn = $("agentStartBtn");
  const stopBtn = $("agentStopBtn");
  const statusEl = $("agentStatus");
  const logEl = $("agentLog");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.style.opacity = "1";
  if (statusEl) { statusEl.textContent = "Running..."; statusEl.style.color = "#00ff66"; }
  if (logEl) logEl.innerHTML = "";
  clearAgentThoughts();
  setAgentThoughtPanelVisible(isAgentThinkingEnabled());

  const history = [];
  const counters = { step: 0, maxSteps: AGENT_STEP_BATCH };

  log(`Agent started: "${task}"`);

  // Wait for canvas to have rendered content before first capture
  if (statusEl) statusEl.textContent = "Waiting for frame...";
  const hasContent = await waitForCanvasContent(3000);
  if (!hasContent) {
    log("Agent: canvas may be blank, proceeding anyway...");
  }

  try {
    const firstCapture = await captureAgentObservation("Planning...");
    const firstDecision = await requestAgentDecision(task, history, firstCapture, {
      mode: "plan",
      stepNumber: "plan",
    });
    addAgentThought("plan", "初始决策", firstDecision.thought || firstDecision.reason || firstDecision.summary || "");

    if (firstDecision.action === "plan" && firstDecision.steps.length > 0) {
      addAgentLog("plan", firstDecision.thought, firstDecision, firstCapture.base64);
      log(`Agent: proposed ${firstDecision.steps.length} plan steps`);
      const approvedSteps = await showPlanPanel(firstDecision.steps, firstDecision.thought);
      if (!approvedSteps || approvedSteps.length === 0) {
        log("Agent: plan cancelled");
        return;
      }
      const normalizedSteps = normalizeAgentPlanSteps(approvedSteps);
      log(`Agent: executing approved plan with ${normalizedSteps.length} steps`);
      const planResult = await executePlan(task, normalizedSteps, history, counters);
      if (planResult === "fail" || planResult === "stop") return;
      log("Agent: approved plan finished, verifying final state");
    } else if (firstDecision.action === "plan") {
      log("Agent: planner returned an empty plan, falling back to current-screen actions");
      history.push({
        step: 0,
        screenshot: firstCapture.base64,
        action: { action: "wait", reason: "Planner returned an empty plan." },
      });
    } else {
      if (firstDecision.action === "wait") {
        firstDecision.duration_ms = getAgentWaitMs(firstDecision);
      }
      addAgentLog(1, firstDecision.thought, firstDecision, firstCapture.base64);
      counters.step = 1;

      if (firstDecision.action === "done") {
        history.push({ step: 1, screenshot: firstCapture.base64, action: firstDecision });
        log(`Agent: task completed — ${firstDecision.summary || ""}`);
        return;
      }
      if (firstDecision.action === "fail") {
        history.push({ step: 1, screenshot: firstCapture.base64, action: firstDecision });
        log(`Agent: task failed — ${firstDecision.reason || ""}`);
        return;
      }
      if (firstDecision.action === "need_more_steps") {
        history.push({ step: 1, screenshot: firstCapture.base64, action: firstDecision });
        log(`Agent: requesting more steps — ${firstDecision.reason || ""}`);
      } else {
        let executionResult = {};
        try {
          executionResult = await executeAgentAction(firstDecision) || {};
        } catch (err) {
          log(`Agent: action execution error: ${err.message}`);
        }
        history.push({ step: 1, screenshot: firstCapture.base64, action: actionWithExecutionResult(firstDecision, executionResult) });
        await agentSleep(1000);
      }
    }

    while (agentState.running) {
      const result = await runAgentActionStep(task, history, counters, { mode: "act" });
      if (result === "done" || result === "fail" || result === "stop") break;
    }
  } catch (err) {
    log(`Agent: ${err.message}`);
  } finally {
    agentState.running = false;
    agentState.abortController = null;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.style.opacity = "0.5";
    if (statusEl) { statusEl.textContent = "Idle"; statusEl.style.color = "#aab2b9"; }
    log("Agent stopped");
  }
}

function agentStop() {
  agentState.running = false;
  if (agentState.abortController) {
    agentState.abortController.abort();
  }
  // Cancel plan panel if open
  if (planResolve) {
    const resolve = planResolve;
    planResolve = null;
    hidePlanPanel();
    resolve(null);
  }
  log("Agent: stopping...");
}

// Agent UI event bindings
const agentThinkingToggle = $("agentThinkingToggle");
if (agentThinkingToggle) {
  agentThinkingToggle.checked = localStorage.getItem("agent_thinking_enabled") === "true";
  setAgentThoughtPanelVisible(agentThinkingToggle.checked);
  agentThinkingToggle.addEventListener("change", () => {
    localStorage.setItem("agent_thinking_enabled", agentThinkingToggle.checked ? "true" : "false");
    setAgentThoughtPanelVisible(agentThinkingToggle.checked);
  });
}

$("agentStartBtn").addEventListener("click", () => {
  const task = $("agentTask").value;
  agentLoop(task);
});

$("agentStopBtn").addEventListener("click", () => {
  agentStop();
});

$("agentTask").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const task = $("agentTask").value;
    agentLoop(task);
  }
});
