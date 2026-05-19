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
  $("logs").appendChild(item);
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

async function fetchScreenSize(serial) {
  if (!serial) return;
  try {
    const data = await api(`/api/devices/${encodeURIComponent(serial)}/wm-size`);
    const match = (data.raw || "").match(/(\d+)x(\d+)/);
    if (match) {
      const maxDim = Math.max(Number(match[1]), Number(match[2]));
      $("maxSize").value = maxDim;
      log(`screen ${match[1]}x${match[2]}, maxSize → ${maxDim}`);
    }
  } catch {
    // device may be offline or unauthorized, ignore
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
    if (current?.state === "device") {
      await fetchScreenSize(state.selected);
    }
  } else {
    $("deviceMeta").textContent = "没有发现授权设备";
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
  btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5.268 5.268c3.272-3.272 8.573-3.272 11.845 0m-9.016 2.828c1.71-1.71 4.48-1.71 6.19 0m-3.896 2.115a2.5 2.5 0 100 5m0-5a2.5 2.5 0 110 5"></path></svg> Start Stream`;
  btn.disabled = false;
  btn.classList.remove("streaming-active");
}

function connectStream() {
  const btn = $("connectBtn");

  // If we are already streaming or connecting, the button acts as STOP!
  if (state.ws) {
    resetStream();
    return;
  }

  const serial = $("deviceSelect").value;
  if (!serial) {
    setStatus("No device", "ADB 没有可用设备");
    return;
  }

  // Set button to connecting state (disabled to prevent spamming)
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" class="animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle><path d="M4 12a8 8 0 0 1 8-8" stroke-linecap="round"></path></svg> Connecting...`;

  const params = new URLSearchParams({
    serial,
    max_size: $("maxSize").value || "1280",
    max_fps: $("maxFps").value,
    bit_rate: $("bitRate").value,
  });
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws/scrcpy?${params}`);
  ws.binaryType = "arraybuffer";
  state.ws = ws;

  const jmuxer = new JMuxer({
    node: 'phoneVideo',
    mode: 'video',
    flushingTime: 100,
    fps: 60,
    debug: false
  });
  state.jmuxer = jmuxer;

  ws.onopen = () => {
    setStatus("Streaming", serial);
    emptyState.style.display = "none";
    log(`stream connected: ${serial}`);

    // Enable button, set to Active Stop state
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"></rect></svg> Stop Stream`;
    btn.classList.add("streaming-active");

    video.play().catch(err => log(`autoplay blocked: ${err.message}`));
  };
  ws.onmessage = (event) => {
    if (state.jmuxer) {
      state.jmuxer.feed({
        video: new Uint8Array(event.data)
      });
    }
  };
  ws.onerror = () => {
    setStatus("Stream error", "查看后端日志获取 scrcpy 细节");
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

$("refreshDevices").addEventListener("click", () => loadDevices().catch((error) => log(error.message)));
$("connectBtn").addEventListener("click", connectStream);
$("deviceSelect").addEventListener("change", async (event) => {
  state.selected = event.target.value;
  const current = state.devices.find((d) => d.serial === state.selected);
  if (current?.state === "device") {
    await fetchScreenSize(state.selected);
  }
});

$("connectBtn2").addEventListener("click", async () => {
  const ip = $("wirelessIp").value.trim();
  const port = $("wirelessPort").value.trim();
  if (!ip || !port) return;
  const addr = `${ip}:${port}`;
  try {
    const res = await api("/api/connect", {
      method: "POST",
      body: JSON.stringify({ address: addr }),
    });
    log(`connect: ${res.message}`);
    await loadDevices();
  } catch (error) {
    log(`connect error: ${error.message}`);
  }
});

$("pairBtn").addEventListener("click", async () => {
  const ip = $("wirelessIp").value.trim();
  const port = $("wirelessPort").value.trim();
  const code = $("pairCode").value.trim();
  if (!ip || !port || !code) return;
  const addr = `${ip}:${port}`;
  try {
    const res = await api("/api/pair", {
      method: "POST",
      body: JSON.stringify({ address: addr, code }),
    });
    log(`pair: ${res.message}`);
    $("pairCode").value = "";
    await loadDevices();
  } catch (error) {
    log(`pair error: ${error.message}`);
  }
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
  .then(() => setStatus("Idle", "选择设备并连接"))
  .catch((error) => {
    setStatus("ADB error", error.message);
    log(error.message);
  });
