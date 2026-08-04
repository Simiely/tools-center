// lib/core/manifest.js - 工具声明解析(manifest.json,兼容 V1 tool.json)
// V2 manifest 字段: id/name/desc/group/icon/runtime/capabilities/entry/port/health/env/hidden/linkUrl
// V1 tool.json 字段: id/name/desc/group/icon/type(app|link)/cmd/cwd/port/health/env/hidden/url
// 规则:优先读 manifest.json;无则读 tool.json 并自动映射为 V2 形态。
import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

/** 读取 JSON,失败返回 null(容错:非法声明标记为无效而非崩溃) */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** 归一化后的工具声明(V2 形态,内部统一使用) */
export function normalizeManifest(raw, fallbackId) {
  const r = raw || {};
  const isV1 = r.type === "app" || r.type === "link";
  const m = {
    id: String(r.id || fallbackId),
    name: String(r.name || fallbackId),
    desc: String(r.desc || ""),
    group: String(r.group || "其他"),
    icon: String(r.icon || "🧰"),
    hidden: !!r.hidden,
    // ---- V2 新增 ----
    runtime: String(r.runtime || "node"),             // 需要的运行时(默认 node)
    capabilities: Array.isArray(r.capabilities) ? r.capabilities : [], // 需要的能力 → 平台装配
    // ---- 入口(由 type/cmd 或 entry 归一) ----
    type: "app",                                      // app(托管) / link(跳转)
    entry: null,                                      // 启动入口(相对目录),app 型
    cmd: [],                                          // 兼容 V1:直接命令数组
    cwd: String(r.cwd || "."),
    port: r.port,
    health: String(r.health || ""),
    env: r.env && typeof r.env === "object" ? r.env : {},
    restart: String(r.restart || "always"),
    linkUrl: String(r.linkUrl || ""),                 // link 型目标
    url: String(r.url || ""),                         // 兼容 V1 link url
  };
  if (isV1) {
    // V1 映射
    m.type = r.type;
    if (r.type === "link") { m.linkUrl = String(r.url || ""); }
    else {
      m.cmd = Array.isArray(r.cmd) ? r.cmd : [];
      // V1 无 capabilities 默认最小集
      m.capabilities = [];
    }
  } else {
    // V2 manifest:entry 字符串 → cmd 数组(运行时 + entry)
    if (r.entry) {
      const run = m.runtime === "node" ? "node" : m.runtime;
      m.cmd = [run, r.entry, String(m.port || "")].filter(Boolean);
    }
    if (r.type === "link") m.type = "link";
    if (r.url) m.linkUrl = r.url;
  }
  // 能力合法性校验(仅记录未知能力,不阻止注册)
  m.unknownCaps = m.capabilities.filter((c) => !CONFIG.KNOWN_CAPABILITIES.includes(c));
  return m;
}

/** 从工具目录加载并归一化声明;返回 null = 无声明文件 */
export function loadManifest(dir, fallbackId) {
  const mf = path.join(dir, "manifest.json");
  if (fs.existsSync(mf)) return normalizeManifest(readJson(mf), fallbackId);
  const tf = path.join(dir, "tool.json");
  if (fs.existsSync(tf)) return normalizeManifest(readJson(tf), fallbackId);
  return null;
}
