// server.mjs - Tools Center 入口(薄层):组装模块 + 路由分发
// 启动: node server.mjs  (PORT 环境变量可改端口,默认 8080)
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CONFIG, DIRS } from "./lib/core/config.js";
import { scanTools, listTools, getTool, createTool, removeTool } from "./lib/core/registry.js";
import * as manager from "./lib/core/manager.js";
import { proxyRequest } from "./lib/core/proxy.js";
import { readLog } from "./lib/core/logger.js";
import { capabilitiesStatus, ensureCapability } from "./lib/core/capability.js";
import { initCapabilities } from "./lib/capabilities/index.js";
import * as backup from "./lib/core/backup.js";
import { loadSyncConfig, saveSyncConfig, testConnection } from "./lib/capabilities/storage/webdav.js";

const ADMIN_PASS_FILE = path.join(DIRS.data, "admin-pass.json");
// 密码以 sha256 摘要存储(不落明文);loadAdminPass 返回摘要,校验时对输入同样摘要后比对
function loadAdminPass() { try { return JSON.parse(fs.readFileSync(ADMIN_PASS_FILE, "utf8")).hash || ""; } catch { return ""; } }
function saveAdminPass(pass) { fs.mkdirSync(DIRS.data, { recursive: true }); fs.writeFileSync(ADMIN_PASS_FILE, JSON.stringify({ hash: crypto.createHash("sha256").update(pass).digest("hex") }), "utf8"); }
function hashPass(pass) { return crypto.createHash("sha256").update(String(pass)).digest("hex"); }

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 上传体积上限 100MB

/** 异步解压:Windows 用 PowerShell Expand-Archive,Linux 用 unzip(不阻塞事件循环) */
function unzipAsync(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === "win32"
      ? "powershell"
      : "unzip";
    const args = process.platform === "win32"
      ? ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`]
      : ["-o", "-q", zipPath, "-d", destDir];
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`解压失败 exit=${code}`)));
  });
}

/** 解析相对路径到 tools/data 根,防目录穿越;非法返回 null */
function resolveWithinRoot(rel) {
  const dest = path.resolve(DIRS.tools, "..", rel);
  const root = path.resolve(DIRS.tools, "..");
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  const body = () => new Promise((resolve, reject) => {
    let s = ""; let size = 0;
    req.on("data", (c) => { s += c; size += c.length; if (size > MAX_UPLOAD_BYTES) { reject(new Error("请求体过大(>100MB)")); req.destroy(); } });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
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
    // ---- API ----
    // 工具列表:每次请求自动重扫 tools/ 目录(放目录+tool.json → 刷新即出现并自动启动)
    if (url.pathname === "/api/tools" && req.method === "GET") {
      scanTools();      // 发现新增/修改/删除的工具目录
      manager.sync();   // 增量:新增的启动,被删的停止
      return json(200, { ok: true, tools: listTools().map(publicTool) });
    }
    // 在线创建工具(自助接入):body = tool.json 完整内容
    if (url.pathname === "/api/tools" && req.method === "POST") {
      let spec;
      try { spec = JSON.parse((await body()) || "{}"); } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
      try {
        const t = createTool(spec);
        manager.sync(); // 启动新工具
        return json(201, { ok: true, tool: publicTool(t) });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }
    // 在线删除工具
    if (url.pathname === "/api/tools" && req.method === "DELETE") {
      let id = "", pass = "";
      try { const b = JSON.parse((await body()) || "{}"); id = String(b.id || ""); pass = String(b.pass || ""); } catch {}
      if (!id) return json(400, { ok: false, error: "缺少 id" });
      const adminPass = loadAdminPass();
      if (adminPass && hashPass(pass) !== adminPass) return json(403, { ok: false, error: "密码错误" });
      try {
        // 先停子进程(否则 Windows 下目录被占用,rmdir EBUSY),再删
        const t = getTool(id);
        if (t && t.type === "app") await manager.stop(t);
        removeTool(id);
        manager.sync();
        return json(200, { ok: true, removed: id });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }
    if (url.pathname === "/api/reload" && req.method === "POST") {
      scanTools();
      manager.sync();
      return json(200, { ok: true, total: listTools().length });
    }
    // 能力模块状态(懒加载:idle/running 等,门户展示)
    if (url.pathname === "/api/capabilities" && req.method === "GET") {
      return json(200, { ok: true, capabilities: capabilitiesStatus() });
    }
    // 能力懒加载触发:POST /api/capabilities/<name>/ensure → 启动模块并返回基址(SDK 调用)
    if (url.pathname.startsWith("/api/capabilities/") && url.pathname.endsWith("/ensure") && req.method === "POST") {
      const name = decodeURIComponent(url.pathname.split("/")[3]);
      try {
        const info = await ensureCapability(name);
        return json(200, { ok: true, ...info });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }
    // ---- 备份/恢复(存储能力,M2) ----
    if (url.pathname === "/api/backup" && req.method === "POST") {
      try { return json(200, { ok: true, ...backup.localBackup() }); }
      catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/backup" && req.method === "GET") {
      return json(200, { ok: true, backups: backup.listBackups() });
    }
    if (url.pathname === "/api/restore" && req.method === "POST") {
      try {
        const b = JSON.parse((await body()) || "{}");
        if (!b.backup) return json(400, { ok: false, error: "缺少 backup(备份目录名)" });
        return json(200, { ok: true, ...backup.localRestore(b.backup) });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    // ---- WebDAV(存储能力,M2) ----
    if (url.pathname === "/api/webdav" && req.method === "GET") {
      const cfg = loadSyncConfig();
      return json(200, { ok: true, configured: !!cfg, url: cfg ? cfg.url : "" });
    }
    if (url.pathname === "/api/webdav" && req.method === "POST") {
      const b = JSON.parse((await body()) || "{}");
      if (!b.url || !b.user || !b.pass) return json(400, { ok: false, error: "需要 url/user/pass" });
      saveSyncConfig({ url: String(b.url), user: String(b.user), pass: String(b.pass) });
      return json(200, { ok: true });
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
        const b = JSON.parse((await body()) || "{}");
        const cfg = loadSyncConfig();
        if (!cfg) return json(400, { ok: false, error: "未配置 WebDAV" });
        // 上传最近一次本地备份(或新做一次)
        const bl = backup.listBackups();
        const ts = b.backup && bl.includes(b.backup) ? b.backup : (bl.length ? bl[bl.length - 1] : null);
        if (!ts) { const nb = backup.localBackup(); return json(200, { ok: true, ...(await backup.webdavUpload(cfg, nb.dir)) }); }
        return json(200, { ok: true, ...(await backup.webdavUpload(cfg, path.join(backup.BACKUPS_ROOT, ts))) });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    if (url.pathname === "/api/webdav/download" && req.method === "POST") {
      try {
        const b = JSON.parse((await body()) || "{}");
        const cfg = loadSyncConfig();
        if (!cfg) return json(400, { ok: false, error: "未配置 WebDAV" });
        if (!b.ts) return json(400, { ok: false, error: "缺少 ts(云端备份时间戳)" });
        const dl = await backup.webdavDownload(cfg, String(b.ts));
        return json(200, { ok: true, ...dl });
      } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    // 管理员密码:状态查询 + 首次设置
    if (url.pathname === "/api/admin/pass") {
      if (req.method === "GET") return json(200, { ok: true, set: !!loadAdminPass() });
      if (req.method === "POST") {
        const { pass } = JSON.parse((await body()) || "{}");
        if (!pass || String(pass).length < 4) return json(400, { ok: false, error: "密码至少4位" });
        if (loadAdminPass()) return json(400, { ok: false, error: "已设置过密码" });
        saveAdminPass(String(pass));
        return json(200, { ok: true });
      }
    }
    if (url.pathname.startsWith("/api/logs/")) {
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      const t = getTool(id);
      if (!t) return json(404, { ok: false, error: "not found" });
      if (t.type !== "app") return json(400, { ok: false, error: "link 型无日志" });
      const lines = Math.min(parseInt(url.searchParams.get("lines") || "200", 10) || 200, 1000);
      return json(200, { ok: true, id, lines: readLog(id, lines) });
    }
    // 通用文件上传: multipart 或 JSON {path, content}
    if (url.pathname === "/api/files" && req.method === "POST") {
      const raw = req.headers["content-type"] || "";
      if (raw.includes("multipart/form-data")) {
        // 解析简单 multipart(无第三方库,手写最小解析);boundary 兼容带引号
        const bm = raw.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = "--" + (bm ? (bm[1] || bm[2] || "").trim() : "");
        if (!boundary) return json(400, { ok: false, error: "缺少 boundary" });
        const chunks = []; let total = 0;
        for await (const c of req) { chunks.push(c); total += c.length; if (total > MAX_UPLOAD_BYTES) { req.destroy(); return json(413, { ok: false, error: "上传过大(>100MB)" }); } }
        const buf = Buffer.concat(chunks);
        const sep = Buffer.from(boundary);
        // 按 boundary 切分,保留二进制完整性
        let parts = [];
        let idx = buf.indexOf(sep);
        while (idx !== -1) {
          const next = buf.indexOf(sep, idx + sep.length);
          if (next === -1) break;
          parts.push(buf.subarray(idx + sep.length, next));
          idx = next;
        }
        let target = "", filename = "", fileBuf = null;
        for (const part of parts) {
          const headEnd = part.indexOf("\r\n\r\n");
          if (headEnd === -1) continue;
          const header = part.subarray(0, headEnd).toString("utf8");
          const body = part.subarray(headEnd + 4);
          const nm = header.match(/name="([^"]+)"/);
          if (!nm) continue;
          if (nm[1] === "path") target = body.toString("utf8").trim();
          if (nm[1] === "file") { fileBuf = body; const fm = header.match(/filename="([^"]*)"/); if (fm) filename = fm[1]; }
        }
        if (!target) return json(400, { ok: false, error: "缺少 path" });
        // path 以 / 结尾视为目录:自动拼接上传文件名(如 tools/wb-credits/ + code.zip)
        const realPath = target.endsWith("/") || target.endsWith("\\") ? target + (filename || "file.bin") : target;
        const dest = resolveWithinRoot(realPath);
        if (!dest) return json(400, { ok: false, error: "路径越界" });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, fileBuf || Buffer.alloc(0));
        // zip 自动解压到目标目录,解压后删除压缩包
        const isZip = realPath.toLowerCase().endsWith(".zip");
        if (isZip) {
          try { await unzipAsync(dest, path.dirname(dest)); }
          catch (e) { try { fs.unlinkSync(dest); } catch {} return json(400, { ok: false, error: e.message }); }
          try { fs.unlinkSync(dest); } catch { /* 删除失败不阻塞(沙箱/只读卷下 zip 残留无害) */ }
        }
        // zip 解压后:若目标是 tools/<id>/ 下的工具,自动重启让新代码/新 tool.json 生效。
        // (否则旧进程继续跑旧配置,registry 已更新,反代按新端口转发必现"上游不可达")
        const tid = isZip ? (realPath.match(/^tools\/([^/]+)\//) || [])[1] : "";
        if (tid) {
          scanTools(); // 必须先刷新 registry:解压已覆盖 tool.json,内存 Map 仍是旧配置
          const t = getTool(tid);
          if (t && t.type === "app") { try { await manager.restart(t); } catch { /* 重启失败不阻塞上传响应 */ } }
        }
        return json(200, { ok: true, path: realPath, unzipped: isZip, restarted: !!tid });
      }
      // JSON 模式(兼容旧)
      const j = JSON.parse((await body()) || "{}");
      if (!j.path) return json(400, { ok: false, error: "缺少 path" });
      const dest = resolveWithinRoot(j.path);
      if (!dest) return json(400, { ok: false, error: "路径越界" });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, j.content ?? "", j.encoding === "base64" ? "base64" : "utf8");
      return json(200, { ok: true, path: j.path });
    }
    // /api/tools/<id> 与 /api/tools/<id>/restart
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
