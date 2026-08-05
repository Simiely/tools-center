// lib/routes/cap.js - 能力域路由 + 静态资源(能力状态/ensure、/js/、首页)
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../core/config.js";
import { sendJson, serveIndex } from "./helpers.js";
import { capabilitiesStatus, ensureCapability } from "../core/capability.js";

export const capRoutes = [
  // ---- API:版本(前端底部显示,便于确认更新是否生效) ----
  {
    m: "GET", p: "/api/version",
    handler: (req, res) => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(DIRS.root, "package.json"), "utf8"));
        return sendJson(res, 200, { ok: true, version: pkg.version || "?", name: pkg.name || "" });
      } catch { return sendJson(res, 200, { ok: true, version: "?" }); }
    },
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
