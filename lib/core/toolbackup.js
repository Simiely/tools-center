// lib/core/toolbackup.js - 工具级备份/恢复(代码+数据全包 → zip)
// 与 backup.js(仅备份 data/tools/* 工具存储数据)不同:
// 本模块备份 tools/<id>/ 整个工具目录(代码 + tool.json + 运行数据如 wb-accounts.json),
// 删错工具后可整体还原。zip 存于 data/backups/tools-<ts>.zip。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { zipPackDirs, zipUnpack } from "./zip.js";
import { getTool, scanTools } from "./registry.js";
import * as manager from "./manager.js";

const BACKUPS_ROOT = path.join(DIRS.data, "backups");
const TOOLBACKUP_PREFIX = "tools-"; // 文件名前缀:tools-<ts>.zip

function safeId(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("非法工具 id: " + id);
  return id;
}

/**
 * 备份所有工具目录 → data/backups/tools-<ts>.zip
 * zip 内结构:tools/<工具id>/...(每个工具一个顶层目录,前缀 tools/ 便于恢复时定位)
 * 注意:直接扫 DIRS.tools 一级子目录(不依赖注册表,挂载型/未注册目录也备份)
 * @returns {{ts: string, file: string, size: number, tools: string[]}}
 */
export function backupTools() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUPS_ROOT, TOOLBACKUP_PREFIX + ts + ".zip");
  fs.mkdirSync(BACKUPS_ROOT, { recursive: true });

  const toolIds = fs.existsSync(DIRS.tools)
    ? fs.readdirSync(DIRS.tools).filter((n) => { try { return fs.statSync(path.join(DIRS.tools, n)).isDirectory(); } catch { return false; } })
    : [];
  // 合并所有工具文件到同一个 zip(zipPackDirs 一次打包,合法单 zip)
  const roots = toolIds.map((id) => ({ dir: path.join(DIRS.tools, id), prefix: "tools/" + id }));
  const buf = zipPackDirs(roots);
  fs.writeFileSync(file, buf);
  return { ts, file: path.basename(file), size: buf.length, tools: toolIds };
}

/**
 * 列出所有工具备份:每个含 {ts, file, size, tools[]}(tools 从 zip 内 tools/ 顶层目录名解析)
 */
export function listToolBackups() {
  if (!fs.existsSync(BACKUPS_ROOT)) return [];
  const out = [];
  for (const name of fs.readdirSync(BACKUPS_ROOT)) {
    if (!name.startsWith(TOOLBACKUP_PREFIX) || !name.endsWith(".zip")) continue;
    const file = path.join(BACKUPS_ROOT, name);
    const st = fs.statSync(file);
    if (!st.isFile()) continue;
    let tools = [];
    try { tools = readZipToolIds(file); } catch { /* 损坏备份跳过详情 */ }
    out.push({ ts: name.slice(TOOLBACKUP_PREFIX.length, -4), file: name, size: st.size, tools });
  }
  return out.sort((a, b) => b.ts.localeCompare(a.ts)); // 新的在前
}

/** 读取 zip 内 tools/ 顶层目录名(工具 id 列表),轻量:只解析中央目录,不落盘 */
export function readZipToolIds(file) {
  const buf = fs.readFileSync(file);
  const entries = zipUnpack(buf);
  const ids = new Set();
  for (const e of entries) {
    const m = e.name.match(/^tools\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * 从备份 zip 恢复指定工具(可多个)。
 * 安全:先停目标进程;目标目录已存在时自动改名 <id>.pre-restore-<ts>(防覆盖误伤);
 * 解包后重扫,恢复的进程重新托管。
 * @param {string} zipName 备份文件名(如 tools-2026-08-04T...-zip 或完整路径)
 * @param {string[]} ids 要恢复的工具 id 列表
 * @returns {{restored: string[], skipped: string[]}}
 */
export function restoreFromZip(zipName, ids) {
  const file = path.resolve(BACKUPS_ROOT, path.basename(zipName));
  if (!fs.existsSync(file)) throw new Error("备份不存在: " + zipName);
  if (!Array.isArray(ids) || !ids.length) throw new Error("未指定要恢复的工具");

  const restoreIds = [...new Set(ids.map((i) => String(i)))];
  restoreIds.forEach(safeId);

  const buf = fs.readFileSync(file);
  const entries = zipUnpack(buf);
  // 分组:tools/<id>/<rel> → { id, rel }
  const byTool = new Map();
  for (const e of entries) {
    const m = e.name.match(/^tools\/([^/]+)\/(.*)$/);
    if (!m) continue;
    const id = m[1];
    const rel = m[2];
    if (!rel) continue; // 目录条目
    if (!byTool.has(id)) byTool.set(id, []);
    byTool.get(id).push({ rel, data: e.data });
  }

  const restored = [];
  const skipped = [];
  for (const id of restoreIds) {
    const files = byTool.get(id);
    if (!files || !files.length) { skipped.push(id); continue; } // 备份里没有该工具

    // 停进程
    const t = getTool(id);
    if (t && t.type === "app") manager.stop(t);

    // 目标目录已存在 → 备份现有
    const dest = path.join(DIRS.tools, id);
    if (fs.existsSync(dest)) {
      const oldName = id + ".pre-restore-" + Date.now().toString(36);
      try { fs.renameSync(dest, path.join(DIRS.tools, oldName)); } catch { /* 改名失败继续 */ }
    }

    // 解包(逐文件写入,防穿越)
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const target = path.resolve(dest, f.rel);
      if (!target.startsWith(path.resolve(dest) + path.sep)) throw new Error("路径越界: " + f.rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.data);
    }
    restored.push(id);
  }

  // 重扫 + 重启新恢复的工具
  scanTools();
  manager.sync();
  return { restored, skipped };
}
