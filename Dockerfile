FROM node:20-slim

# 安装 ffmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 设置工作目录
WORKDIR /app

# 复制 package.json 并安装依赖
COPY server/package*.json ./
RUN npm install

# 复制 server 目录下的所有代码到当前目录
COPY server/ .

# Cloud Run 默认使用 8080 端口
ENV PORT=8080
EXPOSE 8080

# 启动命令：直接运行 server.js (因为它现在就在 /app 根目录下)
CMD ["node", "server.js"]
