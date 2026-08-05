FROM node:22-slim

# zip 解压支持
# 国内网络:apt 源换清华镜像,避免 deb.debian.org 拉取极慢(可选:注释掉即用官方源)
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null || true \
 && apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 仅复制程序本体(工具目录 tools/ 与数据 data/ 是挂载卷,不打包)
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080

# 注意:不再声明 VOLUME。此前 VOLUME ["/app/tools","/app/data"] 与本机 docker compose
# Recreate 的 bind mount 冲突,导致重建后挂载回退/匿名卷接管、宿主目录被波及(2026-08-05 事故)。
# 数据目录统一由 compose 显式 bind mount(见 docker-compose.local.yml),这里不重复声明。

EXPOSE 8080

# 默认以非 root 运行(更安全);宿主挂载卷需要写权限时,
# 在 compose/run 里用 user: root 覆盖(家庭内网部署的常见做法,见 docker-compose.yml)
USER node

CMD ["node", "server.mjs"]
