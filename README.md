# AutoAndroid Pro

Web 端 Android 远程控制与 AI 自动化操作平台。通过浏览器实时投屏操控手机，并可接入视觉大模型让 AI 自主完成复杂任务。

## 功能特性

### 远程控制

- **实时投屏** — 基于 scrcpy + WebSocket + WebCodecs 硬解，低延迟 H.264/H.265 视频流
- **音频转发** — 手机声音实时回传，AudioWorklet 环形缓冲区播放
- **触控操作** — 点击、滑动、拖拽、长按、滚动，所有手势直接在画布上操作
- **快捷按键** — 返回、主页、任务切换、电源键、音量±
- **文本输入** — 从电脑直接向手机发送文字
- **ADB 终端** — 内置智能命令行，自动识别 `adb shell` 与主机命令
- **截图下载** — 一键截取当前画面并保存到电脑

### AI Agent

- **视觉驱动** — 自动截屏 → 坐标网格叠加 → 发送给多模态大模型 → 解析动作 → 执行 → 循环
- **多服务商** — 支持 OpenAI 兼容接口与 Anthropic，可自定义 Endpoint / Key / Model
- **流式传输** — SSE 实时流式返回，思考过程实时可见
- **动作类型** — tap / swipe / type / key / scroll / longpress / wait / done / fail
- **思考模式** — 可开关推理模式，查看 AI 的思考链
- **执行计划** — 复杂任务自动拆解为步骤，用户可审查、编辑、增删后确认执行
- **步骤扩展** — 默认 30 步上限，超出后 AI 可申请更多步数，需用户批准
- **自动修复** — AI 返回格式异常时自动尝试修复

### 系统设置

- **中英双语** — 界面语言一键切换
- **流式开关** — 按需启用/关闭 SSE 流式传输
- **右键行为** — 可选触发返回键或弹出自定义菜单
- **边线隐藏** — 投屏画布边框显示/隐藏
- **视频参数** — 分辨率、帧率、码率、数据块大小均可配置

## 快速开始

### Docker 部署（推荐）

```bash
# 使用 docker compose
docker compose up -d --build

# 或手动构建
docker build -t autoandroid-pro .
docker run -d --network host -v adb-keys:/root/.android autoandroid-pro
```

服务启动后访问 `http://localhost:8000`

### 本地运行

```bash
# 安装依赖
pip install -r requirements.txt

# 需要预装 adb 和 scrcpy
# 启动服务
python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
```

## 多架构镜像

CI 自动构建 `linux/amd64` 和 `linux/arm64` 双架构镜像，推送到 GitHub Container Registry：

```bash
docker pull ghcr.io/yihoong/autoandroid-pro:main
```

## 使用方法

1. 打开浏览器访问 `http://<服务器IP>:8000`
2. 在左侧面板输入手机 IP 和端口，点击「开始配对」或「开始连接」
3. 连接成功后点击「开始推流」进入投屏
4. 如需 AI 操作：进入设置 → AI 配置，填写 API 信息后保存
5. 在 Agent 面板输入任务描述，点击启动即可

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python · FastAPI · Uvicorn · Pydantic |
| 前端 | Vanilla JS · WebCodecs · Web Audio API · WebSocket |
| 投屏 | scrcpy v4.0 · H.264/H.265 |
| 设备 | Android platform-tools (adb) |
| 容器 | Docker · Debian bookworm-slim |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADB_BIN` | adb 可执行文件路径 | `/opt/platform-tools/adb` |
| `SCRCPY_BIN` | scrcpy 可执行文件路径 | `scrcpy` |
| `SCRCPY_SERVER_PATH` | scrcpy-server 路径 | 自动检测 |

## 许可证

MIT
