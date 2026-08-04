// lib/routes/tools.js - 工具域路由:/tool 反代、/api/tools 系列、日志、文件上传、单工具操作
import fs from "node:fs";
import path from "node:path";
import { sendJson, jsonBody, publicTool, refreshTools } from "./helpers.js";
import { scanTools, listTools, getTool, createTool, removeTool, restoreTool, validateManifest } from "../core/registry.js";
import { importFromGit } from "../core/git.js";
import * as manager from "../core/manager.js";
import { proxyRequest } from "../core/proxy.js";
import { readLog } from "../core/logger.js";
import { checkPass } from "../core/auth.js";
import { unzipAsync, resolveWithinRoot, parseMultipart } from "../core/upload.js";

export const toolsRoutes = [
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
        const r = removeTool(id);
        manager.sync();
        return sendJson(res, 200, { ok: true, removed: id, dirKept: r.dirKept });
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
  // 恢复已解除托管的工具(清掉忽略标记,挂载型工具重新识别)
  {
    m: "POST", p: "/api/tools/restore",
    handler: async (req, res) => {
      try {
        const { id } = await jsonBody(req);
        if (!id) return sendJson(res, 400, { ok: false, error: "缺少 id" });
        restoreTool(String(id));
        manager.sync();
        return sendJson(res, 200, { ok: true, restored: String(id) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
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
  // ---- API:单工具操作(通配前缀,必须排在 backup 的 /api/tools/backup* 精确路由之后) ----
];

export const toolsPrefixRoutes = [
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
];
