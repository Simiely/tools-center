// lib/routes/helpers.js - 路由共享工具(JSON 响应 / body 解析 / 工具视图 / 静态首页)
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../core/config.js";
import { listTools, scanTools } from "../core/registry.js";
import * as manager from "../core/manager.js";
import { readBody } from "../core/upload.js";

/** JSON 响应(统一 Content-Type/Cache-Control) */
export const sendJson = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

/** 读取 JSON body(文本),解析失败抛错 */
export async function jsonBody(req) {
  const raw = (await readBody(req)).toString("utf8");
  return JSON.parse(raw || "{}");
}

/** 对外工具视图:隐藏内部字段,附运行状态 */
export function publicTool(t) {
  return {
    id: t.id, name: t.name, desc: t.desc, group: t.group, icon: t.icon,
    type: t.type, url: t.url, port: t.port, valid: t.valid, error: t.error, hidden: !!t.hidden,
    capabilities: t.capabilities || [],
    status: manager.statusOf(t),
  };
}

/** 工具目录扫描节流:距上次扫描 < 500ms 则跳过(避免前端轮询触发全量重扫) */
let lastScanAt = 0;
export function refreshTools() {
  const now = Date.now();
  if (now - lastScanAt > 500) {
    lastScanAt = now;
    scanTools();
    manager.sync();
  }
}

/** 首页 HTML(缺失时给出提示) */
export function serveIndex(res) {
  const f = path.join(DIRS.public, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  return res.end(fs.existsSync(f) ? fs.readFileSync(f) : "<h1>public/index.html 缺失</h1>");
}
