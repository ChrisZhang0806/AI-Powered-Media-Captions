<div align="center">
<img width="1200" height="475" alt="AI Powered Media Captions Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />

[English](#english) | [中文](#中文)
</div>

---

<a name="english"></a>
# AI Powered Media Captions

🎬 **AI-powered automatic subtitle generation and translation tool**

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

## 🌟 Features

- 🎙️ **Speech Recognition** - Powered by OpenAI Whisper for accurate transcription
- 🌐 **Multi-language Translation** - Translate subtitles to 10+ languages using GPT
- 📹 **Video & Audio Support** - Upload video/audio files or subtitle files directly
- ⚡ **Real-time Preview** - Synchronized media playback with subtitle highlighting
- 📥 **Export Options** - Download as SRT or VTT format (bilingual or single language)
- 🎨 **Modern UI** - Beautiful, responsive interface with dark mode support

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or higher
- [OpenAI API Key](https://platform.openai.com/api-keys) (for Whisper and GPT)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/ChrisZhang0806/AI-Powered-Media-Captions.git
   cd ai-powered-media-captions
   ```

2. **Install dependencies**
   ```bash
   # Install frontend dependencies
   npm install
   
   # Install server dependencies
   cd server
   npm install
   cd ..
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` and add your OpenAI API Key:
   ```
   VITE_OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Start the application**
   ```bash
   # Terminal 1: Start the backend server
   cd server
   npm run start
   
   # Terminal 2: Start the frontend
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to `http://localhost:5173`

## 📖 Usage

1. **Upload Media** - Drag and drop or click to upload a video, audio, or subtitle file
2. **Generate Subtitles** - Click "Generate Subtitles" to transcribe using Whisper
3. **Translate** - Select target language and click "Translate" for bilingual subtitles
4. **Preview** - Play media and see subtitles sync in real-time
5. **Export** - Download subtitles in SRT or VTT format

## 🛠️ Tech Stack

| Category | Technologies |
|----------|-------------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Node.js, Express |
| AI/ML | OpenAI Whisper, GPT-4 |
| Media | FFmpeg (via @ffmpeg/ffmpeg) |
| UI | Lucide Icons, Custom CSS |

## 📁 Project Structure

```
ai-powered-media-captions/
├── components/          # React components
├── hooks/               # Custom React hooks
├── services/            # API and service layers
├── utils/               # Utility functions
├── server/              # Backend Express server
│   ├── server.js        # Main server file
│   ├── uploads/         # Uploaded files (gitignored)
│   └── outputs/         # Generated outputs (gitignored)
├── App.tsx              # Main application component
└── index.html           # HTML entry point
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) for Whisper and GPT APIs
- [FFmpeg](https://ffmpeg.org/) for media processing
- All contributors who help improve this project

## 📩 Contact

**Ning Zhang** - [@LinkedIn](https://www.linkedin.com/in/ning-zhang-688903303/)

Project Link: [https://github.com/ChrisZhang0806/AI-Powered-Media-Captions](https://github.com/ChrisZhang0806/AI-Powered-Media-Captions)


---

<a name="中文"></a>
# AI 媒体字幕助手 (AI Powered Media Captions)

🎬 **基于 AI 的自动字幕生成与翻译工具**

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

## 🌟 功能特点

- 🎙️ **语音识别** - 使用 OpenAI Whisper 实现精准转录
- 🌐 **多语言翻译** - 使用 GPT 将字幕翻译成 10+ 种语言
- 📹 **视频和音频支持** - 支持上传视频、音频或字幕文件
- ⚡ **实时预览** - 媒体播放与字幕高亮同步显示
- 📥 **导出选项** - 支持导出 SRT 或 VTT 格式（双语或单语）
- 🎨 **现代界面** - 优美响应式界面，支持深色模式

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) 18 或更高版本
- [OpenAI API Key](https://platform.openai.com/api-keys)（用于 Whisper 和 GPT）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/ChrisZhang0806/AI-Powered-Media-Captions.git
   cd ai-powered-media-captions
   ```

2. **安装依赖**
   ```bash
   # 安装前端依赖
   npm install
   
   # 安装服务端依赖
   cd server
   npm install
   cd ..
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env.local
   ```
   编辑 `.env.local` 并添加你的 OpenAI API Key：
   ```
   VITE_OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **启动应用**
   ```bash
   # 终端 1：启动后端服务器
   cd server
   npm run start
   
   # 终端 2：启动前端
   npm run dev
   ```

5. **打开浏览器**
   
   访问 `http://localhost:5173`

## 📖 使用说明

1. **上传媒体** - 拖放或点击上传视频、音频或字幕文件
2. **生成字幕** - 点击"生成字幕"使用 Whisper 转录
3. **翻译字幕** - 选择目标语言，点击"翻译"生成双语字幕
4. **预览** - 播放媒体，实时查看字幕同步效果
5. **导出** - 下载 SRT 或 VTT 格式的字幕文件

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端 | React 19, TypeScript, Vite |
| 后端 | Node.js, Express |
| AI/ML | OpenAI Whisper, GPT-4 |
| 媒体处理 | FFmpeg (via @ffmpeg/ffmpeg) |
| UI | Lucide Icons, 自定义 CSS |

## 📁 项目结构

```
ai-powered-media-captions/
├── components/          # React 组件
├── hooks/               # 自定义 React hooks
├── services/            # API 和服务层
├── utils/               # 工具函数
├── server/              # 后端 Express 服务器
│   ├── server.js        # 主服务器文件
│   ├── uploads/         # 上传的文件 (已忽略)
│   └── outputs/         # 生成的输出 (已忽略)
├── App.tsx              # 主应用组件
└── index.html           # HTML 入口文件
```

## 🤝 贡献指南

欢迎贡献代码！请阅读 [贡献指南](CONTRIBUTING.md) 了解详情。

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 📄 开源协议

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [OpenAI](https://openai.com/) 提供的 Whisper 和 GPT API
- [FFmpeg](https://ffmpeg.org/) 用于媒体处理
- 所有帮助改进此项目的贡献者

## 📩 联系我

**张宁 (Ning Zhang)** - [@LinkedIn](https://www.linkedin.com/in/ning-zhang-688903303/)

项目地址: [https://github.com/ChrisZhang0806/AI-Powered-Media-Captions](https://github.com/ChrisZhang0806/AI-Powered-Media-Captions)


---

<div align="center">
Made with ☕️ by the Ning Zhang @ Ottawa
</div>
