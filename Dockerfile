FROM debian:bookworm-slim AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-venv \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Install Android platform-tools (adb only) — multi-arch
ARG TARGETARCH
RUN cd /tmp \
    && if [ "$TARGETARCH" = "arm64" ]; then \
         ADB_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip"; \
       else \
         ADB_URL="https://dl.google.com/android/repository/platform-tools-latest-linux.zip"; \
       fi \
    && curl -L -o platform-tools.zip "$ADB_URL" \
    && python3 -c "import zipfile; zipfile.ZipFile('platform-tools.zip').extractall('/opt')" \
    && rm platform-tools.zip

# Install scrcpy v4.0 — multi-arch (x86_64 / aarch64)
RUN cd /tmp \
    && if [ "$TARGETARCH" = "arm64" ]; then \
         SCRCPY_ARCH="aarch64"; \
       else \
         SCRCPY_ARCH="x86_64"; \
       fi \
    && curl -L -o scrcpy-linux-v4.0.tar.gz \
       "https://github.com/Genymobile/scrcpy/releases/download/v4.0/scrcpy-linux-${SCRCPY_ARCH}-v4.0.tar.gz" \
    && tar xzf scrcpy-linux-v4.0.tar.gz \
    && cp scrcpy-linux-${SCRCPY_ARCH}-v4.0/scrcpy /usr/local/bin/scrcpy \
    && chmod +x /usr/local/bin/scrcpy \
    && mkdir -p /usr/local/share/scrcpy \
    && cp scrcpy-linux-${SCRCPY_ARCH}-v4.0/scrcpy-server /usr/local/share/scrcpy/scrcpy-server-v4.0 \
    && rm -rf /tmp/scrcpy-linux-v4.0.tar.gz /tmp/scrcpy-linux-${SCRCPY_ARCH}-v4.0

# Build Python venv
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# --- Final stage ---
FROM debian:bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ADB_BIN=/opt/platform-tools/adb \
    SCRCPY_BIN=/usr/local/bin/scrcpy \
    SCRCPY_SERVER_PATH=/usr/local/share/scrcpy/scrcpy-server-v4.0 \
    PATH="/opt/venv/bin:/opt/platform-tools:$PATH"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      libudev1 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/platform-tools /opt/platform-tools
RUN chmod +x /opt/platform-tools/adb
COPY --from=builder /usr/local/bin/scrcpy /usr/local/bin/scrcpy
COPY --from=builder /usr/local/share/scrcpy /usr/local/share/scrcpy
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
