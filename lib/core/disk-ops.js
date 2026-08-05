// lib/core/disk-ops.js - 磁盘残留管理(存储管理核心业务)
// 职责:扫描 tools/ 目录分类(托管/无效/解除/幽灵)、物理清理、恢复托管、协调"先停进程再删"。
// 依赖 registry 的公开 API(getTool/scanTools)与 lifecycle 的状态 API(isRemoved/isPaused/restoreTool/setPaused),
// 不访问 registry 内部变量;manager 提供进程停止。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { getTool, scanTools } from "./registry.js";
import { isRemoved, isPaused, restoreTool, setPaused } from "./lifecycle.js";
import * as manager from "./manager.js";

/**
 * 磁盘残留清单:列出 tools/ 下所有目录及状态分类。
 * 注册表看不见的"垃圾"(已解除托管 / 无 manifest 幽灵目录 / 无效工具)在这里暴露,可清理。
 * @returns {Array<{dir, id, name, kind, valid, error, hasManifest, removed, paused, type, port, size}>}
 *   kind: managed(托管中) / removed(已解除托管,物理目录在) / ghost(无 manifest 幽灵目录) / invalid(配置无效)
 */
export function scanDisk() {
  const out = [];
  if (!fs.existsSync(DIRS.tools)) return out;
  for (const name of fs.readdirSync(DIRS.tools)) {
    const dir = path.join(DIRS.tools, name);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const t = getTool(name);
    const hasManifest = fs.existsSync(path.join(dir, "manifest.json")) || fs.existsSync(path.join(dir, "tool.json"));
    let kind, valid = false, error = "";
    if (t) { kind = t.valid ? "managed" : "invalid"; valid = t.valid; error = t.error || ""; }
    else if (isRemoved(name)) { kind = "removed"; error = "已解除托管(物理目录保留)"; }
    else if (hasManifest) { kind = "invalid"; error = "配置无效(未扫描进注册表)"; }
    else { kind = "ghost"; error = "无 manifest,扫描跳过(幽灵目录)"; }
    // 目录体积(近似:仅统计顶层文件大小)
    let size = 0;
    try { for (const f of fs.readdirSync(dir)) { try { size += fs.statSync(path.join(dir, f)).size; } catch {} } } catch {}
    out.push({
      dir: name, id: t ? t.id : name, name: t ? t.name : name,
      kind, valid, error, hasManifest,
      removed: isRemoved(name), paused: isPaused(name),
      type: t ? t.type : null, port: t ? t.port : null, size,
    });
  }
  return out;
}

/**
 * 物理清理磁盘残留:删除 tools/<dir> 并清理 removed/paused 记录。
 * 删不掉(占用)则转解除托管标记;删除成功则彻底清掉记录。
 * @param {string[]} dirs 要删除的目录名列表(仅限 tools/ 下,防路径穿越)
 * @returns {Array<{dir, removed, dirKept, error?}>}
 */
export function cleanupDisk(dirs) {
  const list = Array.isArray(dirs) ? dirs : [];
  const results = [];
  for (const raw of list) {
    const name = String(raw || "").trim();
    // 防穿越:只允许 tools/ 下的一级目录名
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      results.push({ dir: name, removed: false, dirKept: true, error: "非法目录名" });
      continue;
    }
    const dir = path.join(DIRS.tools, name);
    let removed = false;
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      removed = !fs.existsSync(dir); // 删除后校验是否真没了
    } catch {}
    // 清理相关记录:restoreTool 清 removed 标记,setPaused(false) 清暂停标记
    restoreTool(name);
    setPaused(name, false);
    results.push({ dir: name, removed, dirKept: !removed });
  }
  scanTools();
  return results;
}

/**
 * 清理(协调):托管中的工具先停进程再删(否则 Windows 下目录被占用删不掉)。
 * 由路由层调用,完成"密码校验 → 停进程 → 物理清理 → 注册表同步"。
 * @param {string[]} dirs
 * @returns {Array} cleanupDisk 结果
 */
export async function cleanWithStop(dirs) {
  for (const d of dirs) {
    const t = getTool(String(d));
    if (t && t.type === "app") await manager.stop(t);
  }
  const results = cleanupDisk(dirs);
  manager.sync();
  return results;
}
