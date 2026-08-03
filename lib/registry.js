// lib/registry.js - 工具注册表:扫描 tools/*/tool.json → Map<id, ToolSpec>
// 区分 app(托管)/ link(跳转);校验字段、类型、端口段与端口冲突。
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./config.js";

let map = new Map();   // id -> ToolSpec
let byPort = new Map(); // port -> id(app 型,冲突检测)

/** 读取 JSON,失败返回 null(容错:非法 tool.json 标记为无效工具而非崩溃) */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** 字段校验,返回错误数组(空 = 通过) */
function validate(spec) {
  const errs = [];
  if (!/^[a-z0-9-]+$/.test(spec.id)) errs.push("id 需为 [a-z0-9-]");
  if (!spec.name) errs.push("缺少 name");
  if (spec.type === "link") {
    if (!spec.url || !/^https?:\/\//.test(spec.url)) errs.push("link 型需 url(http(s)://)");
  } else {
    if (!Array.isArray(spec.cmd) || !spec.cmd.length) errs.push("app 型需 cmd(命令数组)");
    const p = spec.port;
    if (!Number.isInteger(p) || p < CONFIG.TOOL_PORT_MIN || p > CONFIG.TOOL_PORT_MAX) {
      errs.push(`port 需在 ${CONFIG.TOOL_PORT_MIN}-${CONFIG.TOOL_PORT_MAX} 之间`);
    }
  }
  return errs;
}

/**
 * 扫描 tools/ 目录,重建注册表。
 * @returns {Map<string, object>} id -> ToolSpec
 */
export function scanTools() {
  const found = new Map();
  const ports = new Map();
  if (fs.existsSync(DIRS.tools)) {
    for (const name of fs.readdirSync(DIRS.tools)) {
      const dir = path.join(DIRS.tools, name);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      const tf = path.join(dir, "tool.json");
      if (!fs.existsSync(tf)) continue;
      const raw = readJson(tf) || {};
      const spec = {
        id: String(raw.id || name),
        name: String(raw.name || name),
        desc: String(raw.desc || ""),
        group: String(raw.group || "其他"),
        icon: String(raw.icon || "🧰"),
        type: raw.type === "link" ? "link" : "app",
        url: String(raw.url || ""),
        cmd: Array.isArray(raw.cmd) ? raw.cmd : [],
        cwd: String(raw.cwd || "."),
        port: raw.port,
        health: String(raw.health || ""),
        env: raw.env && typeof raw.env === "object" ? raw.env : {},
        restart: String(raw.restart || "always"),
        hidden: !!raw.hidden,
        dir,
        valid: true,
        error: "",
        state: { status: "stopped", health: "unknown", error: "" },
      };
      const errs = validate(spec);
      if (errs.length) {
        spec.valid = false;
        spec.error = errs.join("; ");
      } else if (spec.type === "app") {
        if (ports.has(spec.port)) {
          spec.valid = false;
          spec.error = `端口 ${spec.port} 与 ${ports.get(spec.port)} 冲突`;
        } else {
          ports.set(spec.port, spec.id);
        }
      }
      found.set(spec.id, spec);
    }
  }
  map = found;
  byPort = ports;
  return map;
}

export function getTool(id) { return map.get(id) || null; }
export function listTools() { return [...map.values()]; }
export function getByPort(port) { return byPort.get(port) || null; }
