# 🎙️ 吴语翻译 - 方言智能语音识别与高精度转写平台

基于 **OpenRouter** [`qwen/qwen3-asr-flash-2026-02-10`](https://openrouter.ai/qwen/qwen3-asr-flash-2026-02-10) 与 **阿里云百炼 / DashScope** 官方 `qwen-audio-3.0-asr-flash-filetrans` 模型的方言语音转写与对话分析系统。支持上海话/吴语、粤语、四川话等22+方言及普通话麦克风实时录音、音频/视频文件拖拽上传、高精段时间戳对齐、说话人分离（Diarization）、交互式同步试听播放、实时字幕生成与多格式导出。

---

## ✨ 核心特性

- **🌟 默认搭载最新模型**: 
  - **OpenRouter (推荐)**: [`qwen/qwen3-asr-flash-2026-02-10`](https://openrouter.ai/qwen/qwen3-asr-flash-2026-02-10)（最新 Qwen3-Omni 语音架构，极速响应，支持11+语言、中文方言及抗复杂噪音/背景音乐）。
  - **阿里云百炼 / DashScope**: `qwen-audio-3.0-asr-flash-filetrans`、`qwen3-asr-flash-filetrans`、`sensevoice-v1`、`paraformer-v2`。
- **🎙️ 麦克风实时录音采集**:
  - 纯浏览器原生 Web Audio API 与 `MediaRecorder`，免除系统驱动依赖。
  - 实时动态渐变音频波形图（Waveform Visualizer Canvas）。
  - 支持计时（毫秒级）、暂停、继续、重录及试听。
- **📁 音频 / 视频文件拖拽上传**:
  - 支持格式：`MP3`, `WAV`, `M4A`, `AAC`, `FLAC`, `OGG`, `WebM`, `MP4`, `MOV`, `MKV` 等。
  - 自动识别文件大小与格式信息。
- **⚙️ 灵活的可配置项**:
  - **API Key 配置**: 支持 OpenRouter API Key (`sk-or-v1-...`) 与 DashScope API Key (`sk-...`)，支持在 Web 界面输入、测试连接、浏览器 `localStorage` 自动持久化或系统环境变量 `OPENROUTER_API_KEY` / `DASHSCOPE_API_KEY`。
  - **模型自由切换**: 预设 OpenRouter 与 DashScope 各大主流模型，并支持自定义任意模型 slug。
  - **语言偏好 (Language Hints)**: 支持普通话 (`zh`)、粤语 (`yue`)、英语 (`en`)、日语 (`ja`)、韩语 (`ko`) 或自动语种检测。
  - **说话人区分 (Diarization)**: 区分不同发言人并支持指定说话人数量。
  - **语气词过滤 (Disfluency)**: 智能过滤口语停顿词（如“嗯”、“啊”、“那个”）。
  - **热词与领域上下文 (Prompt)**: 支持输入专有名词、业务术语以极大提升识别准确率。
- **🎵 交互式同步音文联动播放器**:
  - 点击转写结果中的任意句子或时间戳，音频播放器自动跳转至该毫秒起播。
  - 播放过程中当前句子**卡拉OK式高亮**并自动平滑滚动。
  - 支持倍速播放（`0.75x` ~ `2.0x`）。
- **🔍 即时检索与多格式导出**:
  - 识别结果内关键词高亮搜索。
  - 支持一键复制全文、下载为纯文本 (`.txt`)、带时间戳的 Markdown (`.md`)、标准字幕文件 (`.srt`) 以及结构化数据 (`.json`)。
- **🕒 历史会话管理**: 本地持久化保存历史转写记录，随时重新加载与导出。
- **💻 命令行模式 (CLI)**: 支持在终端中进行批量音频转写与字幕生成。

---

## 🚀 快速启动

### 1. 一键启动 Web 应用

```bash
# 方式 1: 直接运行启动脚本（默认加载 qwen/qwen3-asr-flash-2026-02-10）
python3 run_asr.py

# 方式 2: 带 OpenRouter API Key 启动
python3 run_asr.py --api-key "sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx"

# 方式 3: 带 DashScope API Key 启动
python3 run_asr.py --dashscope-key "sk-xxxxxxxxxxxxxxxxxxxxxxxx"
```

启动后在浏览器打开：`http://127.0.0.1:8765/`

### 2. 命令行模式 (CLI)

```bash
# 使用 OpenRouter qwen/qwen3-asr-flash-2026-02-10 转写音频并生成 .srt 和 .md
python3 -m asr_app.cli my_interview.mp3 --model qwen/qwen3-asr-flash-2026-02-10

# 指定语言、开启说话人区分并导出为字幕文件
python3 -m asr_app.cli my_meeting.wav \
  --model qwen/qwen3-asr-flash-2026-02-10 \
  --lang zh,en \
  --output meeting_subtitles.srt
```

---

## 🔑 API Key 获取与配置

- **OpenRouter API Key (推荐)**: 
  - 登录 [OpenRouter Keys](https://openrouter.ai/keys) 创建 API Key。
  - 在终端设置 `export OPENROUTER_API_KEY="sk-or-v1-..."` 或在网页设置面板中输入。
- **DashScope API Key**:
  - 登录 [阿里云百炼 (Model Studio)](https://bailian.console.aliyun.com/?apiKey=1) 获取。
  - 在终端设置 `export DASHSCOPE_API_KEY="sk-..."` 或在网页设置面板中输入。

---

## 🔒 访问密码保护 (Passcode / Token Auth)

通过环境变量或启动参数配置访问密码，即可为系统开启全站与 API 鉴权保护（非常适合部署在 Render 等公网云环境）：

```bash
# 启动时配置访问密码
python3 run_asr.py --passcode "my_secure_passcode"

# 或通过环境变量设置
export APP_PASSCODE="my_secure_passcode"
python3 run_asr.py
```

当配置密码后：
1. 访问网页将展示**访问验证锁屏**，输入正确 Passcode 即可解锁；
2. 会话支持随时点击右上角**锁定**按钮退出；
3. 后端所有 `/api/*` 接口均受 Bearer Token / Passcode 严格校验保护。

---

## 🐳 Docker 容器化部署

### 1. 本地构建并运行 Docker 镜像

```bash
# 构建镜像
docker build -t qwen-asr-app .

# 运行容器（带环境变量配置）
docker run -d \
  --name qwen-asr \
  -p 8765:8765 \
  -e OPENROUTER_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxx" \
  -e APP_PASSCODE="your_secret_passcode" \
  qwen-asr-app
```

访问 `http://localhost:8765/` 即可使用。

---

## ☁️ 部署至 Render 云平台

本项目原生适配 Render 云平台，已内置 `render.yaml` 基础设施配置（Infrastructure as Code）及动态 `$PORT` 端口支持。

### 方法一：通过 Render Dashboard 部署 (推荐)

1. 将代码推送到 GitHub / GitLab 仓库。
2. 登录 [Render Dashboard](https://dashboard.render.com/)，点击 **New +** -> **Web Service**。
3. 连接您的 Git 仓库。
4. 配置服务信息：
   - **Environment / Runtime**: `Docker`
   - **Region**: 选择适合的区域（如 Oregon / Frankfurt / Singapore）
   - **Plan**: `Free` 或 `Starter`
5. 在 **Environment Variables** 添加：
   | 环境变量 | 说明 | 示例值 |
   | :--- | :--- | :--- |
   | `OPENROUTER_API_KEY` | OpenRouter 平台密钥 | `sk-or-v1-xxxxxxxxxxxx` |
   | `APP_PASSCODE` | 访问口令/Token (开启访问保护) | `my_secret_token_123` |
   | `DASHSCOPE_API_KEY` | (可选) 阿里云百炼 API Key | `sk-xxxxxxxx` |
6. 点击 **Create Web Service**，Render 将自动拉取 Dockerfile 完成构建与部署！

### 方法二：使用 Render Blueprint (`render.yaml`)

1. 在 Render Dashboard 点击 **New +** -> **Blueprint**。
2. 选择该仓库，Render 将自动识别 `render.yaml`。
3. 填入 `OPENROUTER_API_KEY` 和 `APP_PASSCODE`，点击 **Apply** 即可一键上线。

---

## 🧪 运行自动化测试

```bash
python3 -m unittest tests/test_asr.py
```

