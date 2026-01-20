# 使用轻量级 Node.js 镜像
FROM node:20-slim

# 1. 安装 ffmpeg (这是处理视频的核心依赖)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. 设置工作目录
WORKDIR /app

# 3. 复制并安装后端依赖
# 我们的后端代码在 server 文件夹下
COPY server/package*.json ./server/
RUN cd server && npm install

# 4. 复制后端源代码
COPY server/ ./server/

# 5. 配置环境变量
# Cloud Run 会自动注入 PORT 环境变量，通常为 8080
ENV PORT=8080
EXPOSE 8080

# 6. 启动服务器
# 注意：路径要指向 server/server.js
CMD ["node", "server/server.js"]
