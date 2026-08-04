// server.mjs - Tools Center 入口(薄层):启动序列 + HTTP/WS 装配
// 启动: node server.mjs [端口]  (PORT 环境变量可改端口,默认 8080)
// 路由表已按域拆分到 lib/routes/(tools/backup/webdav/admin/cap),本文件只负责组装。
import http from "node:http";
import { CONFIG, DIRS } from "./lib/core/config.js";
import { scanTools } from "./lib/core/registry.js";
import * as manager from "./lib/core/manager.js";
import { proxyUpgrade } from "./lib/core/proxy.js";
import { initCapabilities } from "./lib/capabilities/index.js";
import { routes, matchRoute } from "./lib/routes/index.js";
import { sendJson } from "./lib/routes/helpers.js";

await initCapabilities();   // 先注册能力模块(工具扫描时 checkCapabilities 依赖)
scanTools();
manager.startAll();
manager.startHealthLoop();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    const r = matchRoute(url, req.method);
    if (!r) return sendJson(res, 404, { ok: false, error: "not found" });
    await r.handler(req, res, url);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
});

// WebSocket 升级:转发 /tool/<id>/ 到工具进程(工具需要实时推送/WS 时)
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (!proxyUpgrade(req, socket, head, url)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  } catch { try { socket.destroy(); } catch {} }
});

server.listen(parseInt(process.argv[2], 10) || CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Tools Center 已启动: http://127.0.0.1:${parseInt(process.argv[2], 10) || CONFIG.PORT}`);
  console.log(`工具目录: ${DIRS.tools}`);
});
