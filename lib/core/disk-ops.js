// lib/core/disk-ops.js - 磁盘残留管理(存储管理核心业务)
// 职责:扫描 tools/ 目录分类(托管/无效/解除/幽灵)、物理清理、恢复托管、协调"先停进程再删";
//       v0.11.6+ 增加"程序/数据/垃圾"三分类识别(数据可单独清理,升级保留数据)。
// 三分类识别已抽到 lib/core/data-classify.js(公共层,disk-ops 与 tools-files 共用,避免模块互依赖)。
// 依赖 registry 的公开 API(getTool/scanTools)与 lifecycle 的状态 API(isRemoved/isPaused/restoreTool/setPaused),
// 不访问 registry 内部变量;manager 提供进程停止。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { getTool, scanTools } from "./registry.js";
import { isRemoved, isPaused, restoreTool, setPaused, markRemoved } from "./lifecycle.js";
import * as manager from "./manager.js";
import { classifyDirFiles } from "./data-classify.js"; // 数据识别公共层(v0.11.8 抽离)

/**
 * 检测目录是否为挂载点(bind mount / 独立卷)。
 * 原理:挂载点的设备号(st_dev)与其父目录不同——文件系统边界。
 * Windows 下无 st_dev 或行为不同,回退 false(由删除失败错误提示兜底)。
 */
function isMountPoint(dir) {
  try {
    const s1 = fs.statSync(dir);
    const s2 = fs.statSync(path.dirname(dir));
    return s1.dev !== s2.dev;
  } catch { return false; }
}

/**
 * 磁盘残留清单:列出 tools/ 下所有目录及状态分类。
 * 注册表看不见的"垃圾"(已解除托管 / 无 manifest 幽灵目录 / 无效工具)在这里暴露,可清理。
 * v0.11.6+:每项附带 程序/数据/垃圾 三分类统计(progSize/dataSize/junkSize + dataFiles 清单),
 *          数据残留(dataAlone)标注"程序已不在但数据仍占用",便于单独清理。
 * @returns {Array<{dir, id, name, kind, valid, error, hasManifest, removed, paused, type, port,
 *                  size, progSize, dataSize, junkSize, dataFiles, junkFiles, dataAlone, mount?}>}
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
    const mount = isMountPoint(dir); // 独立挂载点(bind mount)标记
    let kind, valid = false, error = "";
    if (t) { kind = t.valid ? "managed" : "invalid"; valid = t.valid; error = t.error || ""; }
    else if (isRemoved(name)) { kind = "removed"; error = "已解除托管(物理目录保留)"; }
    else if (hasManifest) { kind = "invalid"; error = "配置无效(未扫描进注册表)"; }
    else if (mount) { kind = "ghost"; error = "无 manifest 且为独立挂载点,需在宿主层处理"; }
    else { kind = "ghost"; error = "无 manifest,扫描跳过(幽灵目录)"; }
    // 程序/数据/垃圾三分类(2026-08-06):托管工具用其声明的 dataFiles,其余用通用规则
    const cls = classifyDirFiles(dir, t ? t.dataFiles : []);
    const dataAlone = kind !== "managed" && cls.dataSize > 0; // 程序已不在/不可用,数据仍占用
    out.push({
      dir: name, id: t ? t.id : name, name: t ? t.name : name,
      kind, valid, error, hasManifest,
      removed: isRemoved(name), paused: isPaused(name), mount,
      type: t ? t.type : null, port: t ? t.port : null,
      icon: t ? t.icon : "🧰", group: t ? t.group : "工具", desc: t ? t.desc : "",
      size: cls.progSize + cls.dataSize + cls.junkSize,
      progSize: cls.progSize, dataSize: cls.dataSize, junkSize: cls.junkSize,
      dataFiles: cls.data, junkFiles: cls.junk, dataAlone,
    });
  }
  return out;
}

/**
 * 物理清理磁盘残留:删除 tools/<dir> 并清理 removed/paused 记录。
 * 删除成功 → 彻底清掉记录;删除失败(占用/权限/挂载点)→ 保留 removed 标记并返回具体错误,
 * 下次扫描不再重复识别(与 removeTool 的失败语义一致)。
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
    let removed = false, err = "";
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      removed = !fs.existsSync(dir); // 删除后校验是否真没了
    } catch (e) {
      const msg = String(e && e.message || e);
      // EBUSY/EPERM = 目录被占用或为挂载点(容器内 bind mount):给出可操作的提示
      err = /EBUSY|EPERM|busy|locked/i.test(msg)
        ? "目录被占用或为 Docker 挂载点,需在宿主机处理(删除挂载源或改 compose)"
        : msg;
    }
    if (removed) {
      // 删除成功:彻底清掉 removed/paused 记录
      restoreTool(name);
      setPaused(name, false);
    } else {
      // 删除失败:保留 removed 标记(下次扫描跳过,避免"删了又出现"),并带上具体错误
      markRemoved(name);
      if (!err) err = "目录删除失败(可能被占用或为挂载点)";
    }
    results.push({ dir: name, removed, dirKept: !removed, error: err || undefined });
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

/**
 * 只清理数据文件(保留程序,2026-08-06):按三分类识别结果删除数据文件(含 SQLite wal/shm 连带)。
 * 硬保护与程序核心文件在 classifyDirFiles 已排除,不会误删;防路径穿越二次校验。
 * @param {string} dirName tools/ 下目录名
 * @returns {{dir:string, removed:Array<{rel:string,size:number}>, error?:string}}
 */
export function cleanDataFiles(dirName) {
  const name = String(dirName || "").trim();
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    return { dir: name, removed: [], error: "非法目录名" };
  }
  const dir = path.join(DIRS.tools, name);
  if (!fs.existsSync(dir)) return { dir: name, removed: [], error: "目录不存在" };
  const t = getTool(name);
  const cls = classifyDirFiles(dir, t ? t.dataFiles : []);
  const removed = [];
  for (const f of cls.data) {
    const full = path.join(dir, ...f.rel.split("/"));
    if (!full.startsWith(dir + path.sep)) continue; // 二次防穿越
    try { fs.unlinkSync(full); removed.push({ rel: f.rel, size: f.size }); } catch { /* 占用/权限则跳过 */ }
    // 文件删除后尝试清空其父目录(data/ logs/ 等空壳)
    try {
      const p = path.dirname(full);
      if (p !== dir && fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    } catch {}
  }
  scanTools();
  const partial = removed.length !== cls.data.length;
  return { dir: name, removed, error: partial ? "部分数据文件删除失败(可能被占用),其余已清理" : undefined };
}
