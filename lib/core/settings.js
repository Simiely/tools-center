// lib/core/settings.js - 功能开关配置(2026-08-06,v0.11.7)
// 管理所有附加模块是否启用;主干框架(registry/manager/proxy/logger)不可关,固定常开。
// 存储:data/settings.json;环境变量可覆盖(如 MODULES_STORAGE=0 / MODULES_WEBDAV=false)。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";

const FILE = path.join(DIRS.data, "settings.json");

/** 附加模块开关清单(全部默认开启) */
export const MODULE_DEFAULTS = {
  storage: true,      // 存储管理(独立页 /disk.html)
  backup: true,       // 工具/平台备份
  webdav: true,       // WebDAV 云同步
  auth: true,         // 管理密码
  capabilities: true, // 能力模块(browser/storage)
  import: true,       // 在线导入(拖 zip / git 仓库 / zip 链接)
};

/** 模块中文名与说明(前端设置页展示) */
export const MODULE_INFO = {
  storage: { name: "存储管理", desc: "独立页 /disk.html:程序/数据分列、清理、残留回收" },
  backup: { name: "备份", desc: "工具全量备份 zip 与平台数据备份(可还原)" },
  webdav: { name: "WebDAV 云同步", desc: "备份上传/下载到 WebDAV" },
  auth: { name: "管理密码", desc: "密码设置与修改;关闭后所有管理操作免密码" },
  capabilities: { name: "能力模块", desc: "工具可选能力(browser 浏览器 / storage 存储)" },
  import: { name: "在线导入", desc: "拖 zip / Git 仓库 / Release zip 链接导入工具" },
};

function loadRaw() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

/** 读取当前模块开关(env 优先 > settings.json > 默认) */
export function getModules() {
  const raw = loadRaw().modules || {};
  const out = {};
  for (const k of Object.keys(MODULE_DEFAULTS)) {
    const env = process.env["MODULES_" + k.toUpperCase()];
    if (env !== undefined) out[k] = env !== "0" && env.toLowerCase() !== "false";
    else out[k] = raw[k] !== undefined ? !!raw[k] : MODULE_DEFAULTS[k];
  }
  return out;
}

/** 更新模块开关(仅接受已知模块;未提供的沿用现值)并落盘 */
export function setModules(next) {
  const raw = loadRaw();
  const cur = raw.modules || {};
  const merged = {};
  for (const k of Object.keys(MODULE_DEFAULTS)) {
    merged[k] = next[k] !== undefined ? !!next[k] : (cur[k] !== undefined ? !!cur[k] : MODULE_DEFAULTS[k]);
  }
  raw.modules = merged;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
  return merged;
}
