FROM node:22-slim

# zip 解压支持
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 仅复制程序本体(工具目录 tools/ 与数据 data/ 是挂载卷,不打包)
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080

# 数据卷:工具目录(放 tool.json 与工具代码)与运行时数据(日志)
VOLUME ["/app/tools", "/app/data"]

EXPOSE 8080

# 以非 root 运行(配合宿主 PUID/PGID 挂载卷,避免权限错)
USER node

CMD ["node", "server.mjs"]
