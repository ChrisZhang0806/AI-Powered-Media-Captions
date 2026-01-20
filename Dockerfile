FROM node:20-slim

# 1. 安装 FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. 复制根目录的 package.json (包含前端依赖)
COPY package*.json ./

# 3. 安装依赖 (包括 devDependencies，因为构建前端需要 Vite)
RUN npm install

# 4. 复制前端源代码 (排除 node_modules 等)
# 注意：.dockerignore 会帮我们排除不需要的文件
COPY . .

# 5. 构建前端 (生成 /app/dist 目录)
RUN npm run build

# 6. 安装后端依赖
RUN cd server && npm install

# 7. 配置端口
ENV PORT=8080
EXPOSE 8080

# 8. 启动服务器
# 注意：现在我们在 /app 根目录，server.js 在 server/server.js
# server.js 代码里会去 ../dist 找网页文件，也就是 /app/dist，路径刚好匹配
CMD ["node", "server/server.js"]
