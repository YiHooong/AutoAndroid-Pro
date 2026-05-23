FROM ubuntu:24.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ADB_BIN=adb \
    SCRCPY_BIN=/usr/local/bin/scrcpy \
    SCRCPY_SERVER_PATH=/usr/local/share/scrcpy/scrcpy-server-v4.0 \
    DEBIAN_FRONTEND=noninteractive

ARG UBUNTU_MIRROR=http://mirrors.aliyun.com/ubuntu/

RUN sed -i "s#http://archive.ubuntu.com/ubuntu/#${UBUNTU_MIRROR}#g; s#http://security.ubuntu.com/ubuntu/#${UBUNTU_MIRROR}#g" /etc/apt/sources.list.d/ubuntu.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      android-tools-adb \
      ffmpeg \
      libsdl2-2.0-0 \
      curl \
    && rm -rf /var/lib/apt/lists/*

# Install scrcpy v4.0 (pre-built Linux binary + server)
RUN cd /tmp \
    && curl -L -o scrcpy-linux-v4.0.tar.gz \
       https://github.com/Genymobile/scrcpy/releases/download/v4.0/scrcpy-linux-x86_64-v4.0.tar.gz \
    && tar xzf scrcpy-linux-v4.0.tar.gz \
    && cp scrcpy-linux-x86_64-v4.0/scrcpy /usr/local/bin/scrcpy \
    && chmod +x /usr/local/bin/scrcpy \
    && mkdir -p /usr/local/share/scrcpy \
    && cp scrcpy-linux-x86_64-v4.0/scrcpy-server /usr/local/share/scrcpy/scrcpy-server-v4.0 \
    && rm -rf /tmp/scrcpy-linux-v4.0.tar.gz /tmp/scrcpy-linux-x86_64-v4.0

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
