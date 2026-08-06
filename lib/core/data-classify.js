// lib/core/data-classify.js - 数据识别公共层(2026-08-06 v0.11.8)
// 从 disk-ops 抽出的"程序/数据/垃圾"三分类能力:存储管理(disk-ops)与 zip 升级(tools-files)共用,
// 避免附加模块之间互相依赖——二者都只依赖本公共层。
import fs from "node:fs";
import path from "node:path";

/** 硬保护:无论声明如何都算"程序核心",永不清理/永不归为数据 */
export const PROTECTED_FILES = new Set([
  "tool.json", "manifest.json", "package.json",
  "Dockerfile", "docker-compose.yml", "docker-compose.nas.example.yml", ".dockerignore",
  "README.md", "LICENSE", ".gitignore",
]);

/** 平台通用数据规则(glob,相对工具目录,叠加工具声明的 dataFiles) */
export const DEFAULT_DATA_PATTERNS = [
  "*.db", "*.db-wal", "*.db-shm", "*.sqlite", "*.sqlite3", "*.log",
  "data/**", "logs/**", "uploads/**", "upload/**",
  ".env", ".env.*", ".workbuddy/**", ".data/**", "wb-*.json",
];

/** 平台通用垃圾规则(临时/残留文件,可一键清理) */
export const DEFAULT_JUNK_PATTERNS = [
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
export function dirSize(dir) {
  let total = 0;
  try { for (const name of fs.readdirSync(dir)) { try { const st = fs.statSync(path.join(dir, name)); total += st.isDirectory() ? dirSize(path.join(dir, name)) : st.size; } catch {} } } catch {}
  return total;
}

/**
 * 分类工具目录内文件:程序(可重建) / 数据(用户数据,单独清理) / 垃圾(临时残留)。
 * 遍历时:node_modules/.git 整体归程序;硬保护文件永不归数据;声明与通用规则取并集。
 * @param {string} dir 工具目录
 * @param {string[]} [declared] 工具声明的 dataFiles glob
 * @returns {{data:Array<{name,rel,size,mtime}>, junk:Array, progSize:number, dataSize:number, junkSize:number}}
 *   清单按 size 降序
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
        if (name === "node_modules" || name === ".git") { progSize += dirSize(full); continue; }
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
