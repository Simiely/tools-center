// lib/core/disk-ops.js - 磁盘残留管理(存储管理核心业务)
// 职责:扫描 tools/ 目录分类(托管/无效/解除/幽灵)、物理清理、恢复托管、协调"先停进程再删";
//       v0.11.6+ 增加"程序/数据/垃圾"三分类识别(数据可单独清理,升级保留数据)。
// 依赖 registry 的公开 API(getTool/scanTools)与 lifecycle 的状态 API(isRemoved/isPaused/restoreTool/setPaused),
// 不访问 registry 内部变量;manager 提供进程停止。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { getTool, scanTools } from "./registry.js";
import { isRemoved, isPaused, restoreTool, setPaused, markRemoved } from "./lifecycle.js";
import * as manager from "./manager.js";

// ---------- 程序/数据/垃圾 三分类识别(2026-08-06) ----------

/** 硬保护:无论声明如何都算"程序核心",永不清理/永不归为数据 */
const PROTECTED_FILES = new Set([
  "tool.json", "manifest.json", "package.json",
  "Dockerfile", "docker-compose.yml", "docker-compose.nas.example.yml", ".dockerignore",
  "README.md", "LICENSE", ".gitignore",
]);

/** 平台通用数据规则(glob,相对工具目录,叠加工具声明的 dataFiles) */
const DEFAULT_DATA_PATTERNS = [
  "*.db", "*.db-wal", "*.db-shm", "*.sqlite", "*.sqlite3", "*.log",
  "data/**", "logs/**", "uploads/**", "upload/**",
  ".env", ".env.*", ".workbuddy/**", ".data/**", "wb-*.json",
];

/** 平台通用垃圾规则(临时/残留文件,可一键清理) */
const DEFAULT_JUNK_PATTERNS = [
  "upload.zip", ".tmp-*", "*.tmp", "*.bak", "*.bak-*", "*.old", "*.orig", "Thumbs.db", ".DS_Store",
];

/** 简单 glob 匹配(零依赖):支持 * (段内)与 ** (跨目录) */
function globMatch(relPath, pattern) {
  const segs = relPath.split("/");
  const psegs = pattern.split("/");
  const m = (i, j) => {
    if (j === psegs.length) return i === segs.length;
    const p = psegs[j];
    if (p === "**") { for (let k = i; k <= segs.length; k++) if (m(k, j + 1)) return true; return false; }
    if (i >= segs.length) return false;
    const re = new RegExp("^" + p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return re.test(segs[i]) && m(i + 1, j + 1);
  };
  return m(0, 0);
}
function matchesAny(relPath, patterns) { return patterns.some((p) => globMatch(relPath, p)); }

/** 递归统计目录总字节(不跟随符号链接) */
function dirSize(dir) {
  let total = 0;
  try { for (const name of fs.readdirSync(dir)) { try { const st = fs.statSync(path.join(dir, name)); total += st.isDirectory() ? dirSize(path.join(dir, name)) : st.size; } catch {} } } catch {}
  return total;
}

/**
 * 分类工具目录内文件:程序(可重建) / 数据(用户数据,单独清理) / 垃圾(临时残留)。
 * 遍历时:node_modules 整体归程序;硬保护文件永不归数据;声明与通用规则取并集。
 * @param {string} dir 工具目录
 * @param {string[]} [declared] 工具声明的 dataFiles glob
 * @returns {{data:Array<{name,rel,size,mtime}>, junk:Array, progSize:number, dataSize:number, junkSize:number}}
 *   返回清单按 size 降序
 */
export function classifyDirFiles(dir, declared = []) {
  const patterns = [...DEFAULT_DATA_PATTERNS, ...(declared || [])];
  const data = [], junk = [];
  let progSize = 0, dataSize = 0, junkSize = 0;
  const walk = (cur, rel) => {
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const relPath = rel ? rel + "/" + name : name;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === "node_modules") { progSize += dirSize(full); continue; } // 可重建,归程序
        if (name === ".git") { progSize += dirSize(full); continue; }
        walk(full, relPath);
        continue;
      }
      if (!st.isFile()) continue;
      if (PROTECTED_FILES.has(name)) { progSize += st.size; continue; }
      if (matchesAny(relPath, DEFAULT_JUNK_PATTERNS)) { junk.push({ name, rel: relPath, size: st.size, mtime: st.mtimeMs }); junkSize += st.size; continue; }
      if (matchesAny(relPath, patterns)) { data.push({ name, rel: relPath, size: st.size, mtime: st.mtimeMs }); dataSize += st.size; continue; }
      progSize += st.size;
    }
  };
  walk(dir, "");
  const bySize = (a, b) => b.size - a.size;
  data.sort(bySize);
  junk.sort(bySize);
  return { data, junk, progSize, dataSize, junkSize };
}

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
