// lib/core/lifecycle.js - 工具生命周期状态管理(独立于注册表)
// 职责:维护两类持久化状态集合——
//   removedSet:已解除托管的工具 id(挂载型工具目录删除失败 EBUSY 时记录;扫描时跳过)
//   pausedSet :已暂停的工具 id(暂停 = 不自动启动/不自动拉起)
// 状态持久化在 data/removed-tools.json 与 data/paused-tools.json(平台数据目录)。
// 注意:本模块只管理"标记",不触发扫描/进程操作;调用方负责 scanTools()/manager.sync()。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";

const REMOVED_FILE = path.join(DIRS.data, "removed-tools.json");
const PAUSED_FILE = path.join(DIRS.data, "paused-tools.json");

let removedSet = loadRemoved();
let pausedSet = loadPaused();

function loadRemoved() {
  try { return new Set(JSON.parse(fs.readFileSync(REMOVED_FILE, "utf8")) || []); } catch { return new Set(); }
}
function saveRemoved() {
  try { fs.mkdirSync(DIRS.data, { recursive: true }); fs.writeFileSync(REMOVED_FILE, JSON.stringify([...removedSet]), "utf8"); } catch {}
}
function loadPaused() {
  try { return new Set(JSON.parse(fs.readFileSync(PAUSED_FILE, "utf8")) || []); } catch { return new Set(); }
}
function savePaused() {
  try { fs.mkdirSync(DIRS.data, { recursive: true }); fs.writeFileSync(PAUSED_FILE, JSON.stringify([...pausedSet]), "utf8"); } catch {}
}

/** 工具是否已暂停 */
export function isPaused(id) { return pausedSet.has(id); }

/** 暂停/恢复工具(持久化标记;调用方需随后 manager.sync 使停止生效) */
export function setPaused(id, paused) {
  if (paused) pausedSet.add(id); else pausedSet.delete(id);
  savePaused();
  return true;
}

/** 工具是否已解除托管(挂载型工具删除后重扫会跳过) */
export function isRemoved(id) { return removedSet.has(id); }

/**
 * 恢复已解除托管的工具:清掉忽略标记(下次扫描重新识别)。
 * 只清标记,不触发扫描;调用方负责 scanTools()/manager.sync()。
 */
export function restoreTool(id) {
  removedSet.delete(id);
  saveRemoved();
  return true;
}

/** 解除托管:记录忽略标记(重扫跳过,物理目录保留) */
export function markRemoved(id) {
  removedSet.add(id);
  saveRemoved();
  return true;
}
