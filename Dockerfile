FROM ubuntu:24.04

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ADB_BIN=adb \
    SCRCPY_BIN=scrcpy \
    DEBIAN_FRONTEND=noninteractive

ARG UBUNTU_MIRROR=http://mirrors.aliyun.com/ubuntu/

RUN sed -i "s#http://archive.ubuntu.com/ubuntu/#${UBUNTU_MIRROR}#g; s#http://security.ubuntu.com/ubuntu/#${UBUNTU_MIRROR}#g" /etc/apt/sources.list.d/ubuntu.sources

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      android-tools-adb \
      ffmpeg \
      scrcpy \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
