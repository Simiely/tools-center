// server.mjs - Tools Center 入口(薄层):组装模块 + 路由分发
// 启动: node server.mjs  (PORT 环境变量可改端口,默认 8080)
import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./lib/config.js";
import { scanTools, listTools, getTool, createTool, removeTool } from "./lib/registry.js";
import * as manager from "./lib/manager.js";
import { proxyRequest } from "./lib/proxy.js";
import { readLog } from "./lib/logger.js";

scanTools();
manager.startAll();
manager.startHealthLoop();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

/** 对外工具视图:隐藏内部字段,附运行状态 */
function publicTool(t) {
  return {
    id: t.id, name: t.name, desc: t.desc, group: t.group, icon: t.icon,
    type: t.type, url: t.url, port: t.port, valid: t.valid, error: t.error,
    status: manager.statusOf(t),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
  const body = () => new Promise((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); });
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
      let id = "";
      try { id = String(JSON.parse((await body()) || "{}").id || ""); } catch {}
      if (!id) return json(400, { ok: false, error: "缺少 id" });
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
        // 解析简单 multipart(无第三方库,手写最小解析)
        const boundary = "--" + raw.split("boundary=")[1]?.trim();
        if (!boundary) return json(400, { ok: false, error: "缺少 boundary" });
        const chunks = []; for await (const c of req) chunks.push(c);
        const buf = Buffer.concat(chunks).toString("binary");
        const parts = buf.split(boundary).slice(1, -1);
        let target = "", content = "";
        for (const p of parts) {
          const [header, ...bodyLines] = p.replace(/^\r?\n/, "").split("\r\n\r\n");
          const nameMatch = header.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const body = bodyLines.join("\r\n\r\n").replace(/\r?\n--$/, "");
          if (nameMatch[1] === "path") target = body.trim();
          if (nameMatch[1] === "file") content = body;
        }
        if (!target) return json(400, { ok: false, error: "缺少 path" });
        const dest = path.resolve(DIRS.tools, "..", target); // 限定在 tools/ 和 data/ 同级
        const root = path.resolve(DIRS.tools, "..");
        if (dest !== root && !dest.startsWith(root + path.sep)) return json(400, { ok: false, error: "路径越界" });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(content, "binary"));
        // zip 自动解压到目标目录,解压后删除压缩包
        if (target.toLowerCase().endsWith(".zip")) {
          const dir = path.dirname(dest);
          try { execSync("unzip -o -q \"" + dest + "\" -d \"" + dir + "\"", { stdio: "pipe" }); } catch (e) {
            fs.unlinkSync(dest); return json(400, { ok: false, error: "解压失败: " + e.message });
          }
          fs.unlinkSync(dest);
        }
        return json(200, { ok: true, path: target, unzipped: target.toLowerCase().endsWith(".zip") });
      }
      // JSON 模式(兼容旧)
      const j = JSON.parse((await body()) || "{}");
      if (!j.path) return json(400, { ok: false, error: "缺少 path" });
      const dest = path.resolve(DIRS.tools, "..", j.path);
      const root = path.resolve(DIRS.tools, "..");
      if (dest !== root && !dest.startsWith(root + path.sep)) return json(400, { ok: false, error: "路径越界" });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, j.content ?? "", j.encoding === "base64" ? "base64" : "utf8");
      return json(200, { ok: true, path: j.path });
    }
    // /api/tools/<id> 与 /api/tools/<id>/restart、/upload
    if (url.pathname.startsWith("/api/tools/")) {
      const parts = url.pathname.split("/"); // ["","api","tools",id,maybe action]
      const id = decodeURIComponent(parts[3] || "");
      const t = getTool(id);
      if (!t) return json(404, { ok: false, error: "tool not found" });
      // 上传代码/文件到工具目录(网页接入:填名称后把用户自己的程序放进去)
      if (parts[4] === "upload" && req.method === "POST") {
        let j;
        try { j = JSON.parse((await body()) || "{}"); } catch { return json(400, { ok: false, error: "JSON 解析失败" }); }
        // name 可为子路径(如 lib/accounts.js);去前导 ../ 并校验最终路径仍在工具目录内
        const raw = String(j.name || "").replace(/^[\\/]+/, "");
        const target = path.resolve(t.dir, raw);
        if (!raw || target !== t.dir && !target.startsWith(t.dir + path.sep)) {
          return json(400, { ok: false, error: "非法路径" });
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, String(j.content ?? ""), "utf8");
          return json(200, { ok: true, name: raw, hint: "文件已写入,重启工具生效" });
        } catch (e) {
          return json(500, { ok: false, error: e.message });
        }
      }
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

server.listen(CONFIG.PORT, "0.0.0.0", () => {
  console.log(`Tools Center 已启动: http://127.0.0.1:${CONFIG.PORT}`);
  console.log(`工具目录: ${DIRS.tools}`);
});
