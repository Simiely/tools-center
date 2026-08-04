// server.mjs - Tools Center 入口(薄层):组装模块 + 路由分发
// 启动: node server.mjs [端口]  (PORT 环境变量可改端口,默认 8080)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./lib/core/config.js";
import { scanTools, listTools, getTool, createTool, removeTool, validateManifest } from "./lib/core/registry.js";
import { importFromGit } from "./lib/core/git.js";
import * as manager from "./lib/core/manager.js";
import { proxyRequest, proxyUpgrade } from "./lib/core/proxy.js";
import { readLog } from "./lib/core/logger.js";
import { capabilitiesStatus, ensureCapability } from "./lib/core/capability.js";
import { initCapabilities } from "./lib/capabilities/index.js";
import * as backup from "./lib/core/backup.js";
import { loadSyncConfig, saveSyncConfig, testConnection } from "./lib/core/webdav.js";
import { loadAdminPass, saveAdminPass, checkPass, changeAdminPass } from "./lib/core/auth.js";
import { unzipAsync, resolveWithinRoot, parseMultipart, readBody, MAX_UPLOAD_BYTES } from "./lib/core/upload.js";

await initCapabilities();   // 先注册能力模块(工具扫描时 checkCapabilities 依赖)
scanTools();
manager.startAll();
manager.startHealthLoop();

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".wasm": "application/wasm", ".pdf": "application/pdf", ".zip": "application/zip",
};

/** 对外工具视图:隐藏内部字段,附运行状态 */
function publicTool(t) {
  return {
    id: t.id, name: t.name, desc: t.desc, group: t.group, icon: t.icon,
    type: t.type, url: t.url, port: t.port, valid: t.valid, error: t.error, hidden: !!t.hidden,
    capabilities: t.capabilities || [],
    status: manager.statusOf(t),
  };
}

/** 读取 JSON body(文本),解析失败抛错 */
async function jsonBody(req) {
  const raw = (await readBody(req)).toString("utf8");
  return JSON.parse(raw || "{}");
}

/** 工具目录扫描节流:距上次扫描 < 500ms 则跳过(避免前端轮询触发全量重扫) */
let lastScanAt = 0;
function refreshTools() {
  const now = Date.now();
  if (now - lastScanAt > 500) {
    lastScanAt = now;
    scanTools();
    manager.sync();
  }
}

/** JSON 响应(统一 Content-Type/Cache-Control) */
const sendJson = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

/**
 * 路由表:顺序匹配,先精确(p)后前缀(prefix)再正则(re);method 为空表示任意方法。
 * 保持与原 if/else 链一致的匹配顺序(精确优先于前缀,长前缀优先于短前缀)。
 */
const routes = [
  // ---- 工具路由:反代(app)/ 302(link) ----
  // 规范化: /tool/<id> 无尾斜杠 → 301 到 /tool/<id>/
  // (否则页面内相对路径 ./xxx 会解析到 /tool/xxx 而非 /tool/<id>/xxx,JS/资源 404)
  {
    re: /^\/tool\/[^/]+$/,
    handler: (req, res, url) => { res.writeHead(301, { Location: url.pathname + "/" + (url.search || "") }); return res.end(); },
  },
  {
    re: /^\/tool(?:\/|$)/,
    handler: (req, res, url) => { proxyRequest(req, res, url); },
  },
  // ---- API:工具 ----
  {
    m: "GET", p: "/api/tools",
    handler: (req, res) => { refreshTools(); return sendJson(res, 200, { ok: true, tools: listTools().map(publicTool) }); },
  },
  {
    m: "POST", p: "/api/tools",
    handler: async (req, res) => {
      let spec;
      try { spec = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      try {
        const t = createTool(spec);
        manager.sync();
        return sendJson(res, 201, { ok: true, tool: publicTool(t) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "DELETE", p: "/api/tools",
    handler: async (req, res) => {
      let id = "", pass = "";
      try { const b = await jsonBody(req); id = String(b.id || ""); pass = String(b.pass || ""); } catch {}
      if (!id) return sendJson(res, 400, { ok: false, error: "缺少 id" });
      if (!checkPass(pass)) return sendJson(res, 403, { ok: false, error: "密码错误" });
      try {
        const t = getTool(id);
        if (t && t.type === "app") await manager.stop(t);  // 先停子进程(否则 Windows 下目录被占用)
        removeTool(id);
        manager.sync();
        return sendJson(res, 200, { ok: true, removed: id });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/tools/validate",
    handler: async (req, res) => {
      let raw;
      try { raw = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      const r = validateManifest(raw.manifest || raw);
      return sendJson(res, r.ok ? 200 : 400, { ok: r.ok, errors: r.errors, normalized: r.normalized });
    },
  },
  {
    m: "POST", p: "/api/tools/import",
    handler: async (req, res) => {
      let b;
      try { b = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      if (!b.url) return sendJson(res, 400, { ok: false, error: "缺少 url" });
      try {
        // exists 回调:导入期间用当前注册表检查目标 id 是否已存在(防覆盖已托管工具)
        const { id } = await importFromGit(String(b.url), String(b.id || ""), {
          branch: b.branch ? String(b.branch) : undefined,
          exists: (tid) => !!getTool(tid),
        });
        manager.sync();
        const t = getTool(id);
        return sendJson(res, 201, { ok: true, tool: publicTool(t) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/reload",
    handler: (req, res) => { scanTools(); manager.sync(); return sendJson(res, 200, { ok: true, total: listTools().length }); },
  },
  // ---- API:能力 ----
  {
    m: "GET", p: "/api/capabilities",
    handler: (req, res) => sendJson(res, 200, { ok: true, capabilities: capabilitiesStatus() }),
  },
  {
    m: "POST", prefix: "/api/capabilities/", suffix: "/ensure",
    handler: async (req, res, url) => {
      const name = decodeURIComponent(url.pathname.split("/")[3]);
      try {
        const info = await ensureCapability(name);
        return sendJson(res, 200, { ok: true, ...info });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  // ---- API:备份/恢复 ----
  {
    m: "POST", p: "/api/backup",
    handler: (req, res) => { try { return sendJson(res, 200, { ok: true, ...backup.localBackup() }); } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); } },
  },
  {
    m: "GET", p: "/api/backup",
    handler: (req, res) => sendJson(res, 200, { ok: true, backups: backup.listBackups() }),
  },
  {
    m: "POST", p: "/api/restore",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.backup) return sendJson(res, 400, { ok: false, error: "缺少 backup(备份目录名)" });
        return sendJson(res, 200, { ok: true, ...backup.localRestore(b.backup) });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  // ---- API:WebDAV ----
  {
    m: "GET", p: "/api/webdav",
    handler: (req, res) => { const cfg = loadSyncConfig(); return sendJson(res, 200, { ok: true, configured: !!cfg, url: cfg ? cfg.url : "" }); },
  },
  {
    m: "POST", p: "/api/webdav",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.url || !b.user || !b.pass) return sendJson(res, 400, { ok: false, error: "需要 url/user/pass" });
        saveSyncConfig({ url: String(b.url), user: String(b.user), pass: String(b.pass) });
        return sendJson(res, 200, { ok: true });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/test",
    handler: async (req, res) => {
      try {
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        await testConnection(cfg.url, cfg.user, cfg.pass);
        return sendJson(res, 200, { ok: true });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/upload",
    handler: async (req, res) => {
      try {
        let b = {};
        try { b = await jsonBody(req); } catch {}
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        const bl = backup.listBackups();
        const ts = b.backup && bl.includes(b.backup) ? b.backup : (bl.length ? bl[bl.length - 1] : null);
        if (!ts) { const nb = backup.localBackup(); return sendJson(res, 200, { ok: true, ...(await backup.webdavUpload(cfg, nb.dir)) }); }
        return sendJson(res, 200, { ok: true, ...(await backup.webdavUpload(cfg, path.join(backup.BACKUPS_ROOT, ts))) });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/download",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        if (!b.ts) return sendJson(res, 400, { ok: false, error: "缺少 ts(云端备份时间戳)" });
        const dl = await backup.webdavDownload(cfg, String(b.ts));
        return sendJson(res, 200, { ok: true, ...dl });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  // ---- API:管理员密码 ----
  {
    p: "/api/admin/pass",
    handler: async (req, res) => {
      if (req.method === "GET") return sendJson(res, 200, { ok: true, set: !!loadAdminPass() });
      if (req.method === "POST") {
        try {
          const { pass } = await jsonBody(req);
          if (!pass || String(pass).length < 4) return sendJson(res, 400, { ok: false, error: "密码至少4位" });
          if (loadAdminPass()) return sendJson(res, 400, { ok: false, error: "已设置过密码" });
          saveAdminPass(String(pass));
          return sendJson(res, 200, { ok: true });
        } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    },
  },
  {
    m: "POST", p: "/api/admin/pass/change",
    handler: async (req, res) => {
      try {
        const { oldPass, newPass } = await jsonBody(req);
        const r = changeAdminPass(oldPass, newPass);
        return sendJson(res, r.ok ? 200 : 400, r);
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  // ---- API:工具日志 ----
  {
    prefix: "/api/logs/",
    handler: (req, res, url) => {
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      const t = getTool(id);
      if (!t) return sendJson(res, 404, { ok: false, error: "not found" });
      if (t.type !== "app") return sendJson(res, 400, { ok: false, error: "link 型无日志" });
      const lines = Math.min(parseInt(url.searchParams.get("lines") || "200", 10) || 200, 1000);
      return sendJson(res, 200, { ok: true, id, lines: readLog(id, lines) });
    },
  },
  // ---- API:文件上传(工具代码/zip) ----
  {
    m: "POST", p: "/api/files",
    handler: async (req, res) => {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        try {
          const { fields, files } = await parseMultipart(req, contentType);
          if (!fields.path) return sendJson(res, 400, { ok: false, error: "缺少 path" });
          const f = files[0];
          if (!f) return sendJson(res, 400, { ok: false, error: "缺少 file" });
          const target = fields.path;
          // path 以 / 结尾视为目录:自动拼接上传文件名(如 tools/wb-credits/ + code.zip)
          const realPath = target.endsWith("/") || target.endsWith("\\") ? target + (f.filename || "file.bin") : target;
          const dest = resolveWithinRoot(realPath);
          if (!dest) return sendJson(res, 400, { ok: false, error: "路径越界" });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, f.data || Buffer.alloc(0));
          // zip 自动解压到目标目录,解压后删除压缩包
          const isZip = realPath.toLowerCase().endsWith(".zip");
          if (isZip) {
            try { await unzipAsync(dest, path.dirname(dest)); }
            catch (e) { try { fs.unlinkSync(dest); } catch {} return sendJson(res, 400, { ok: false, error: e.message }); }
            try { fs.unlinkSync(dest); } catch { /* 删除失败不阻塞(沙箱/只读卷下 zip 残留无害) */ }
          }
          // zip 解压后:若目标是 tools/<id>/ 下的工具,自动重启让新代码/新 tool.json 生效
          const tid = isZip ? (realPath.match(/^tools\/([^/]+)\//) || [])[1] : "";
          if (tid) {
            scanTools(); // 必须先刷新 registry:解压已覆盖 tool.json,内存 Map 仍是旧配置
            const t = getTool(tid);
            if (t && t.type === "app") { try { await manager.restart(t); } catch {} }
          }
          return sendJson(res, 200, { ok: true, path: realPath, unzipped: isZip, restarted: !!tid });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      // JSON 模式(兼容旧)
      try {
        const j = await jsonBody(req);
        if (!j.path) return sendJson(res, 400, { ok: false, error: "缺少 path" });
        const dest = resolveWithinRoot(j.path);
        if (!dest) return sendJson(res, 400, { ok: false, error: "路径越界" });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, j.content ?? "", j.encoding === "base64" ? "base64" : "utf8");
        return sendJson(res, 200, { ok: true, path: j.path });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  // ---- API:单工具操作 ----
  {
    prefix: "/api/tools/",
    handler: async (req, res, url) => {
      const parts = url.pathname.split("/"); // ["","api","tools",id,maybe action]
      const id = decodeURIComponent(parts[3] || "");
      const t = getTool(id);
      if (!t) return sendJson(res, 404, { ok: false, error: "tool not found" });
      if (parts[4] === "restart" && req.method === "POST") {
        if (t.type !== "app") return sendJson(res, 400, { ok: false, error: "link 型不支持重启" });
        await manager.restart(t);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 200, { ok: true, tool: publicTool(t) });
    },
  },
  // ---- 静态资源(public/js 等,防路径穿越) ----
  {
    prefix: "/js/",
    handler: (req, res, url) => {
      const name = decodeURIComponent(url.pathname.slice(4)); // 去掉 /js/ 前缀
      const f = path.join(DIRS.public, "js", name);
      if (!f.startsWith(path.join(DIRS.public, "js") + path.sep)) return sendJson(res, 403, { ok: false, error: "forbidden" });
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return sendJson(res, 404, { ok: false, error: "not found" });
      const ext = path.extname(f).toLowerCase();
      const ct = { ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(f));
    },
  },
  // ---- 首页/静态 ----
  {
    p: "/",
    handler: (req, res) => serveIndex(res),
  },
  {
    p: "/index.html",
    handler: (req, res) => serveIndex(res),
  },
];

function serveIndex(res) {
  const f = path.join(DIRS.public, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  return res.end(fs.existsSync(f) ? fs.readFileSync(f) : "<h1>public/index.html 缺失</h1>");
}

/** 路由匹配:顺序遍历,method 未指定(任意)或相等 + p/prefix/re 命中即返回 */
function matchRoute(url, method) {
  for (const r of routes) {
    if (r.m && r.m !== method) continue;
    if (r.p && url.pathname === r.p) return r;
    if (r.prefix && url.pathname.startsWith(r.prefix) && (!r.suffix || url.pathname.endsWith(r.suffix))) return r;
    if (r.re && r.re.test(url.pathname)) return r;
  }
  return null;
}

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
