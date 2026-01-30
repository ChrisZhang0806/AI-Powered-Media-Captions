import { app, BrowserWindow, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let serverProcess = null;

// 获取资源目录（开发 vs 打包）
function getResourcesPath() {
    if (app.isPackaged) {
        return process.resourcesPath;
    }
    return path.join(__dirname, '..');
}

// 获取 FFmpeg 路径
function getFFmpegPath() {
    const resourcesPath = getResourcesPath();
    const platform = process.platform === 'darwin' ? 'mac' : 'win';
    const ext = process.platform === 'win32' ? '.exe' : '';

    if (app.isPackaged) {
        return path.join(resourcesPath, 'ffmpeg', `ffmpeg${ext}`);
    }
    return path.join(resourcesPath, 'ffmpeg-bin', platform, `ffmpeg${ext}`);
}

// 获取服务器目录
function getServerPath() {
    if (app.isPackaged) {
        // extraResources 会将 server 目录复制到 Resources/server
        return path.join(getResourcesPath(), 'server');
    }
    return path.join(__dirname, '..', 'server');
}

// 启动后端服务器
function startServer() {
    return new Promise((resolve, reject) => {
        const serverPath = getServerPath();
        const serverFile = path.join(serverPath, 'server.js');

        if (!fs.existsSync(serverFile)) {
            reject(new Error(`Server file not found: ${serverFile}`));
            return;
        }

        const ffmpegPath = getFFmpegPath();
        const ffprobePath = ffmpegPath.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');

        console.log('[Electron] Starting server from:', serverFile);
        console.log('[Electron] FFmpeg path:', ffmpegPath);

        const env = {
            ...process.env,
            FFMPEG_PATH: ffmpegPath,
            FFPROBE_PATH: ffprobePath,
            PORT: '3001',
            ELECTRON_RUN_AS_NODE: '1'
        };

        // 使用 Electron 内置的 Node.js 运行时
        // ELECTRON_RUN_AS_NODE=1 让 Electron 以 Node.js 模式运行
        serverProcess = spawn(process.execPath, [serverFile], {
            cwd: serverPath,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`[Server] ${data.toString().trim()}`);
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`[Server Error] ${data.toString().trim()}`);
        });

        serverProcess.on('error', (err) => {
            console.error('[Server] Failed to start:', err);
            reject(err);
        });

        // 等待服务器启动
        setTimeout(() => {
            resolve();
        }, 2000);
    });
}

// 创建主窗口
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        titleBarStyle: 'hiddenInset',
        show: false
    });

    // 加载应用
    if (app.isPackaged) {
        // 生产模式：从后端服务器加载
        mainWindow.loadURL('http://localhost:3001');
    } else {
        // 开发模式：从 Vite 开发服务器加载
        mainWindow.loadURL('http://localhost:3000');
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// 应用准备就绪
app.whenReady().then(async () => {
    try {
        // 生产模式下启动服务器
        if (app.isPackaged) {
            await startServer();
        }

        createWindow();
    } catch (err) {
        dialog.showErrorBox('启动失败', err.message);
        app.quit();
    }
});

// macOS 点击 dock 图标重新打开窗口
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 退出前清理
app.on('before-quit', () => {
    if (serverProcess) {
        console.log('[Electron] Stopping server...');
        serverProcess.kill();
        serverProcess = null;
    }
});
