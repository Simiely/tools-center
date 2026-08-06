// lib/core/settings.js - 功能开关配置(2026-08-06,v0.11.7;v0.11.8 模块清单改引 modules.js)
// 管理所有附加模块是否启用;主干框架(registry/manager/proxy/logger)不可关,固定常开。
// 存储:data/settings.json;环境变量可覆盖(如 MODULES_STORAGE=0 / MODULES_WEBDAV=false)。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { MODULE_DEFAULTS, MODULE_INFO, MODULE_KEYS } from "./modules.js";

const FILE = path.join(DIRS.data, "settings.json");

function loadRaw() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

/** 读取当前模块开关(env 优先 > settings.json > 默认) */
export function getModules() {
  const raw = loadRaw().modules || {};
  const out = {};
  for (const k of MODULE_KEYS) {
    const env = process.env["MODULES_" + k.toUpperCase()];
    if (env !== undefined) out[k] = env !== "0" && env.toLowerCase() !== "false";
    else out[k] = raw[k] !== undefined ? !!raw[k] : MODULE_DEFAULTS[k];
  }
  return out;
}

/** 更新模块开关(仅接受注册表内的模块;未提供的沿用现值)并落盘 */
export function setModules(next) {
  const raw = loadRaw();
  const cur = raw.modules || {};
  const merged = {};
  for (const k of MODULE_KEYS) {
    merged[k] = next[k] !== undefined ? !!next[k] : (cur[k] !== undefined ? !!cur[k] : MODULE_DEFAULTS[k]);
  }
  raw.modules = merged;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
  return merged;
}

export { MODULE_INFO }; // 前端设置页展示信息(转发自注册表)
