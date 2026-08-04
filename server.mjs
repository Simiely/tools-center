// server.mjs - Tools Center 入口(薄层):组装模块 + 路由分发
// 启动: node server.mjs [端口]  (PORT 环境变量可改端口,默认 8080)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./lib/core/config.js";
import { scanTools, listTools, getTool, createTool, removeTool, validateManifest } from "./lib/core/registry.js";
import { importFromGit } from "./lib/core/git.js";
import * as manager from "./lib/core/manager.js";
import { proxyRequest } from "./lib/core/proxy.js";
import { readLog } from "./lib/core/logger.js";
import { capabilitiesStatus, ensureCapability } from "./lib/core/capability.js";
import { initCapabilities } from "./lib/capabilities/index.js";
import * as backup from "./lib/core/backup.js";
import { loadSyncConfig, saveSyncConfig, testConnection } from "./lib/core/webdav.js";
import { loadAdminPass, saveAdminPass, checkPass } from "./lib/core/auth.js";
import { unzipAsync, resolveWithinRoot, parseMultipart, readBody, MAX_UPLOAD_BYTES } from "./lib/core/upload.js";

await initCapabilities();   // 先注册能力模块(工具扫描时 checkCapabilities 依赖)
scanTools();
manager.startAll();
manager.startHealthLoop();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  try {
    // ---- 工具路由:反代(app)/ 302(link) ----
    // 规范化: /tool/<id> 无尾斜杠 → 301 到 /tool/<id>/
    // (否则页面内相对路径 ./xxx 会解析到 /tool/xxx 而非 /tool/<id>/xxx,JS/资源 404)
    if (/^\/tool\/[^/]+$/.test(url.pathname)) {
      res.writeHead(301, { Location: url.pathname + "/" + (url.search || "") });
      return res.end();
    }
    if (url.pathname === "/tool" || url.pathname.startsWith("/tool/")) {
      proxyRequest(req, res, url);
      return;
    }
    // ---- API:工具 ----
    if (url.pathname === "/api/tools" && req.method === "GET") {
      refreshTools();
      return json(200, { ok: true, tools: listTools().map(publicTool) });
    }
    if (url.pathname === "/api/tools" && req.method === "POST") {
      let spec;
      try { spec = await jsonBody(req); } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
      try {
        const t = createTool(spec);
        manager.sync();
        return json(201, { ok: true, tool: publicTool(t) });
      } catch (e) { return json(400, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/tools" && req.method === "DELETE") {
      let id = "", pass = "";
      try { const b = await jsonBody(req); id = String(b.id || ""); pass = String(b.pass || ""); } catch {}
      if (!id) return json(400, { ok: false, error: "缺少 id" });
      if (!checkPass(pass)) return json(403, { ok: false, error: "密码错误" });
      try {
        const t = getTool(id);
        if (t && t.type === "app") await manager.stop(t);  // 先停子进程(否则 Windows 下目录被占用)
        removeTool(id);
        manager.sync();
        return json(200, { ok: true, removed: id });
      } catch (e) { return json(400, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/tools/validate" && req.method === "POST") {
      let raw;
      try { raw = await jsonBody(req); } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
      const r = validateManifest(raw.manifest || raw);
      return json(r.ok ? 200 : 400, { ok: r.ok, errors: r.errors, normalized: r.normalized });
    }
    if (url.pathname === "/api/tools/import" && req.method === "POST") {
      let b;
      try { b = await jsonBody(req); } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
      if (!b.url) return json(400, { ok: false, error: "缺少 url" });
      try {
        const { id } = await importFromGit(String(b.url), String(b.id || ""), { branch: b.branch ? String(b.branch) : undefined });
        manager.sync();
        const t = getTool(id);
        return json(201, { ok: true, tool: publicTool(t) });
      } catch (e) { return json(400, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/reload" && req.method === "POST") {
      scanTools();
      manager.sync();
      return json(200, { ok: true, total: listTools().length });
    }
    // ---- API:能力 ----
    if (url.pathname === "/api/capabilities" && req.method === "GET") {
      return json(200, { ok: true, capabilities: capabilitiesStatus() });
    }
    if (url.pathname.startsWith("/api/capabilities/") && url.pathname.endsWith("/ensure") && req.method === "POST") {
      const name = decodeURIComponent(url.pathname.split("/")[3]);
      try {
        const info = await ensureCapability(name);
        return json(200, { ok: true, ...info });
      } catch (e) { return json(400, { ok: false, error: e.message }); }
    }
    // ---- API:备份/恢复 ----
    if (url.pathname === "/api/backup" && req.method === "POST") {
      try { return json(200, { ok: true, ...backup.localBackup() }); }
      catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/backup" && req.method === "GET") {
      return json(200, { ok: true, backups: backup.listBackups() });
    }
    if (url.pathname === "/api/restore" && req.method === "POST") {
      try {
        const b = await jsonBody(req);
        if (!b.backup) return json(400, { ok: false, error: "缺少 backup(备份目录名)" });
        return json(200, { ok: true, ...backup.localRestore(b.backup) });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    // ---- API:WebDAV ----
    if (url.pathname === "/api/webdav" && req.method === "GET") {
      const cfg = loadSyncConfig();
      return json(200, { ok: true, configured: !!cfg, url: cfg ? cfg.url : "" });
    }
    if (url.pathname === "/api/webdav" && req.method === "POST") {
      try {
        const b = await jsonBody(req);
        if (!b.url || !b.user || !b.pass) return json(400, { ok: false, error: "需要 url/user/pass" });
        saveSyncConfig({ url: String(b.url), user: String(b.user), pass: String(b.pass) });
        return json(200, { ok: true });
      } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
    }
    if (url.pathname === "/api/webdav/test" && req.method === "POST") {
      try {
        const cfg = loadSyncConfig();
        if (!cfg) return json(400, { ok: false, error: "未配置 WebDAV" });
        await testConnection(cfg.url, cfg.user, cfg.pass);
        return json(200, { ok: true });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/webdav/upload" && req.method === "POST") {
      try {
        let b = {};
        try { b = await jsonBody(req); } catch {}
        const cfg = loadSyncConfig();
        if (!cfg) return json(400, { ok: false, error: "未配置 WebDAV" });
        const bl = backup.listBackups();
        const ts = b.backup && bl.includes(b.backup) ? b.backup : (bl.length ? bl[bl.length - 1] : null);
        if (!ts) { const nb = backup.localBackup(); return json(200, { ok: true, ...(await backup.webdavUpload(cfg, nb.dir)) }); }
        return json(200, { ok: true, ...(await backup.webdavUpload(cfg, path.join(backup.BACKUPS_ROOT, ts))) });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/webdav/download" && req.method === "POST") {
      try {
        const b = await jsonBody(req);
        const cfg = loadSyncConfig();
        if (!cfg) return json(400, { ok: false, error: "未配置 WebDAV" });
        if (!b.ts) return json(400, { ok: false, error: "缺少 ts(云端备份时间戳)" });
        const dl = await backup.webdavDownload(cfg, String(b.ts));
        return json(200, { ok: true, ...dl });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    // ---- API:管理员密码 ----
    if (url.pathname === "/api/admin/pass") {
      if (req.method === "GET") return json(200, { ok: true, set: !!loadAdminPass() });
      if (req.method === "POST") {
        try {
          const { pass } = await jsonBody(req);
          if (!pass || String(pass).length < 4) return json(400, { ok: false, error: "密码至少4位" });
          if (loadAdminPass()) return json(400, { ok: false, error: "已设置过密码" });
          saveAdminPass(String(pass));
          return json(200, { ok: true });
        } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
      }
    }
    // ---- API:工具日志 ----
    if (url.pathname.startsWith("/api/logs/")) {
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      const t = getTool(id);
      if (!t) return json(404, { ok: false, error: "not found" });
      if (t.type !== "app") return json(400, { ok: false, error: "link 型无日志" });
      const lines = Math.min(parseInt(url.searchParams.get("lines") || "200", 10) || 200, 1000);
      return json(200, { ok: true, id, lines: readLog(id, lines) });
    }
    // ---- API:文件上传(工具代码/zip) ----
    if (url.pathname === "/api/files" && req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        try {
          const { fields, files } = await parseMultipart(req, contentType);
          if (!fields.path) return json(400, { ok: false, error: "缺少 path" });
          const f = files[0];
          if (!f) return json(400, { ok: false, error: "缺少 file" });
          const target = fields.path;
          // path 以 / 结尾视为目录:自动拼接上传文件名(如 tools/wb-credits/ + code.zip)
          const realPath = target.endsWith("/") || target.endsWith("\\") ? target + (f.filename || "file.bin") : target;
          const dest = resolveWithinRoot(realPath);
          if (!dest) return json(400, { ok: false, error: "路径越界" });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, f.data || Buffer.alloc(0));
          // zip 自动解压到目标目录,解压后删除压缩包
          const isZip = realPath.toLowerCase().endsWith(".zip");
          if (isZip) {
            try { await unzipAsync(dest, path.dirname(dest)); }
            catch (e) { try { fs.unlinkSync(dest); } catch {} return json(400, { ok: false, error: e.message }); }
            try { fs.unlinkSync(dest); } catch { /* 删除失败不阻塞(沙箱/只读卷下 zip 残留无害) */ }
          }
          // zip 解压后:若目标是 tools/<id>/ 下的工具,自动重启让新代码/新 tool.json 生效
          const tid = isZip ? (realPath.match(/^tools\/([^/]+)\//) || [])[1] : "";
          if (tid) {
            scanTools(); // 必须先刷新 registry:解压已覆盖 tool.json,内存 Map 仍是旧配置
            const t = getTool(tid);
            if (t && t.type === "app") { try { await manager.restart(t); } catch {} }
          }
          return json(200, { ok: true, path: realPath, unzipped: isZip, restarted: !!tid });
        } catch (e) { return json(400, { ok: false, error: e.message }); }
      }
      // JSON 模式(兼容旧)
      try {
        const j = await jsonBody(req);
        if (!j.path) return json(400, { ok: false, error: "缺少 path" });
        const dest = resolveWithinRoot(j.path);
        if (!dest) return json(400, { ok: false, error: "路径越界" });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, j.content ?? "", j.encoding === "base64" ? "base64" : "utf8");
        return json(200, { ok: true, path: j.path });
      } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
    }
    // ---- API:单工具操作 ----
    if (url.pathname.startsWith("/api/tools/")) {
      const parts = url.pathname.split("/"); // ["","api","tools",id,maybe action]
      const id = decodeURIComponent(parts[3] || "");
      const t = getTool(id);
      if (!t) return json(404, { ok: false, error: "tool not found" });
      if (parts[4] === "restart" && req.method === "POST") {
        if (t.type !== "app") return json(400, { ok: false, error: "link 型不支持重启" });
        await manager.restart(t);
        return json(200, { ok: true });
      }
      return json(200, { ok: true, tool: publicTool(t) });
    }
    // ---- 首页/静态 ----
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const f = path.join(DIRS.public, "index.html");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f) : "<h1>public/index.html 缺失</h1>");
    }
    json(404, { ok: false, error: "not found" });
  } catch (e) {
    json(500, { ok: false, error: e.message });
  }
});

server.listen(parseInt(process.argv[2], 10) || CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Tools Center 已启动: http://127.0.0.1:${parseInt(process.argv[2], 10) || CONFIG.PORT}`);
  console.log(`工具目录: ${DIRS.tools}`);
});
