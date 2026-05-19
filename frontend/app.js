const state = {
  devices: [],
  selected: "",
  ws: null,
  jmuxer: null,
  dragStart: null,
};

const $ = (id) => document.getElementById(id);
const video = $("phoneVideo");
const emptyState = $("emptyState");

function log(message) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
  
  const container = $("logs");
  // Prepend at the top so newest is always at the absolute top
  container.insertBefore(item, container.firstChild);
  
  // Keep scrollbar pinned to the top to see the newest entry immediately
  container.scrollTop = 0;
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
    throw new Error(body.detail || response.statusText);
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
      const maxDim = Math.max(w, h);
      $("maxSize").value = maxDim;
      log(`Device resolution loaded: ${w}x${h} (Max: ${maxDim}px)`);
    } else {
      $("maxSize").value = "1280";
    }
  } catch (err) {
    log(`Failed to fetch device resolution: ${err.message}`);
    $("maxSize").value = "1280";
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

function resetStream() {
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  if (state.jmuxer) {
    state.jmuxer.destroy();
    state.jmuxer = null;
  }
  video.removeAttribute("src");
  video.load();
  emptyState.style.display = "block";

  // Reset button state
  const btn = $("connectBtn");
  btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path stroke-linecap="round" stroke-linejoin="round" d="M5.268 5.268c3.272-3.272 8.573-3.272 11.845 0m-9.016 2.828c1.71-1.71 4.48-1.71 6.19 0m-3.896 2.115a2.5 2.5 0 100 5m0-5a2.5 2.5 0 110 5"></path></svg> Start Stream`;
  btn.disabled = false;
  btn.classList.remove("streaming-active");
}

function connectStream() {
  const btn = $("connectBtn");

  // If streaming is active, act as a Stop action
  if (state.ws) {
    resetStream();
    return;
  }

  const serial = $("deviceSelect").value;
  if (!serial) {
    setStatus("No device", "ADB is empty or has no selected device");
    return;
  }

  // Throttle button during connection handshake
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline-block; vertical-align:middle; margin-right:4px;"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M4 12a8 8 0 0 1 8-8" stroke-linecap="round"></path></svg> Connecting...`;

  const bitRate = ($("bitRateValue").value || "8") + $("bitRateUnit").value;
  const params = new URLSearchParams({
    serial,
    max_size: $("maxSize").value || "1280",
    max_fps: $("maxFps").value || "60",
    bit_rate: bitRate,
  });
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws/scrcpy?${params}`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  state.jmuxer = new window.JMuxer({
    node: "phoneVideo",
    mode: "video",
    flushingTime: 100, // Safe flushing time for smooth MSE appending
    fps: Number($("maxFps").value) || 60,
    debug: false,
  });

  ws.onopen = () => {
    setStatus("Streaming", serial);
    emptyState.style.display = "none";
    log(`stream connected: ${serial}`);

    // Enable button in Stop state
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline-block; vertical-align:middle; margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg> Stop Stream`;
    btn.classList.add("streaming-active");
  };
  ws.onmessage = (event) => {
    state.jmuxer?.feed({
      video: new Uint8Array(event.data)
    });
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

function videoPoint(event) {
  const rect = video.getBoundingClientRect();
  const scaleX = video.videoWidth / rect.width;
  const scaleY = video.videoHeight / rect.height;
  return {
    x: Math.round((event.clientX - rect.left) * scaleX),
    y: Math.round((event.clientY - rect.top) * scaleY),
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

// Wireless connect handling
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

// Wireless pairing handling
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
    $("wirelessPort").value = ""; // Clear pairing port since it is different from connect port
    $("pairCode").value = "";     // Clear pairing code since pairing is complete
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

video.addEventListener("pointerdown", (event) => {
  if (!video.videoWidth) return;
  video.setPointerCapture(event.pointerId);
  state.dragStart = {
    ...videoPoint(event),
    time: performance.now(),
  };
});

video.addEventListener("pointerup", async (event) => {
  if (!state.dragStart || !video.videoWidth) return;
  const end = videoPoint(event);
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

loadDevices()
  .then(() => setStatus("Ready", "Select a device and connect"))
  .catch((error) => {
    setStatus("ADB error", error.message);
    log(error.message);
  });
