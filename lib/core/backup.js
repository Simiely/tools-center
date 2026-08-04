// lib/core/backup.js - 平台级备份/恢复(工具数据)
// 本地备份:data/backups/<ts>/ 下复制每个工具的 CAP_STORAGE_DIR(含 manifest 快照)
// WebDAV:备份目录逐文件上传到 <webdav>/tools-center/backup/<ts>/(含 manifest.json 快照)
// 恢复:从本地备份目录或 WebDAV 目录回拷 data/tools/<id>/
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";
import { listTools } from "./registry.js";
import * as webdav from "./webdav.js";

const BACKUPS_ROOT = path.join(DIRS.data, "backups");

function toolDataDir(toolId) { return path.join(DIRS.data, "tools", toolId); }

/** 递归收集目录下文件(相对路径列表) */
function walk(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = fs.statSync(p);
    if (s.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

/** 生成 manifest 快照(供恢复时校验工具存在) */
function snapshot() {
  return { ts: new Date().toISOString(), tools: listTools().map((t) => ({ id: t.id, name: t.name, capabilities: t.capabilities || [] })) };
}

/** 本地备份:复制 data/tools/* → data/backups/<ts>/,返回备份目录 */
export function localBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(BACKUPS_ROOT, ts);
  fs.mkdirSync(dest, { recursive: true });
  // manifest 快照
  fs.writeFileSync(path.join(dest, "_manifest.json"), JSON.stringify(snapshot(), null, 2), "utf8");
  // 工具数据
  for (const t of listTools()) {
    const src = toolDataDir(t.id);
    if (!fs.existsSync(src)) continue;
    const tdir = path.join(dest, t.id);
    fs.mkdirSync(tdir, { recursive: true });
    for (const rel of walk(src)) {
      const from = path.join(src, rel);
      const to = path.join(tdir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  return { ts, dir: dest, tools: listTools().map((t) => t.id) };
}

/** 本地恢复:从备份目录回拷;backup 形如 data/backups/<ts> 或 data/backups/<ts>/ */
export function localRestore(backupDir) {
  const src = path.resolve(backupDir);
  if (!src.startsWith(path.resolve(BACKUPS_ROOT) + path.sep)) throw new Error("非法备份路径");
  if (!fs.existsSync(path.join(src, "_manifest.json"))) throw new Error("不是有效备份(缺 _manifest.json)");
  const restored = [];
  for (const name of fs.readdirSync(src)) {
    if (name === "_manifest.json") continue;
    const from = path.join(src, name);
    if (!fs.statSync(from).isDirectory()) continue;
    const to = toolDataDir(name);
    fs.mkdirSync(to, { recursive: true });
    for (const rel of walk(from)) {
      const f = path.join(from, rel);
      const t = path.join(to, rel);
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.copyFileSync(f, t);
    }
    restored.push(name);
  }
  return { restored };
}

/** 列出本地备份 */
export function listBackups() {
  if (!fs.existsSync(BACKUPS_ROOT)) return [];
  return fs.readdirSync(BACKUPS_ROOT).filter((n) => fs.statSync(path.join(BACKUPS_ROOT, n)).isDirectory());
}

/** WebDAV 上传整个本地备份目录(先写 _filelist.json 供下载列举) */
export async function webdavUpload(cfg, backupDir) {
  const { url, user, pass } = cfg;
  const ts = path.basename(backupDir);
  const dir = `${webdav.BACKUP_DIR}/${ts}`;
  // 文件清单(下载时用于列举)
  const filelist = {};
  for (const name of fs.readdirSync(backupDir)) {
    if (name === "_manifest.json") continue;
    const tdir = path.join(backupDir, name);
    if (fs.statSync(tdir).isDirectory()) filelist[name] = walk(tdir);
  }
  await webdav.uploadFile(url, user, pass, dir, "_filelist.json", JSON.stringify(filelist));
  // manifest 快照
  await webdav.uploadFile(url, user, pass, dir, "_manifest.json", fs.readFileSync(path.join(backupDir, "_manifest.json"), "utf8"));
  // 各工具数据文件
  for (const [toolId, files] of Object.entries(filelist)) {
    const tdir = path.join(backupDir, toolId);
    for (const rel of files) {
      await webdav.uploadFile(url, user, pass, `${dir}/${toolId}`, rel, fs.readFileSync(path.join(tdir, rel)));
    }
  }
  return { ts, uploaded: true };
}

/** WebDAV 下载备份目录 → 本地恢复点 */
export async function webdavDownload(cfg, remoteTs) {
  const { url, user, pass } = cfg;
  const dir = `${webdav.BACKUP_DIR}/${remoteTs}`;
  const manifestRaw = await webdav.downloadFile(url, user, pass, dir, "_manifest.json");
  if (!manifestRaw) throw new Error("云端无该备份: " + remoteTs);
  const manifest = JSON.parse(manifestRaw);
  const dest = path.join(BACKUPS_ROOT, remoteTs);
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "_manifest.json"), manifestRaw, "utf8");
  for (const t of manifest.tools || []) {
    const tdir = path.join(dest, t.id);
    fs.mkdirSync(tdir, { recursive: true });
    // 逐文件下载(文件名即相对路径,含子目录分隔符)
    const files = await webdavListFiles(url, user, pass, `${dir}/${t.id}`);
    for (const rel of files) {
      const content = await webdav.downloadFile(url, user, pass, `${dir}/${t.id}`, rel);
      if (content === null) continue;
      const to = path.join(tdir, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, content);
    }
  }
  return { ts: remoteTs, dir: dest, tools: manifest.tools || [] };
}

/** 简单列出 WebDAV 目录文件:读上传时记录的 _filelist.json(见 webdavUpload,免 PROPFIND/XML) */
export async function webdavListFiles(base, user, pass, dir) {
  // 尝试读上传时记录的 _filelist.json(含每个工具的文件清单)
  const raw = await webdav.downloadFile(base, user, pass, dir, "_filelist.json");
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return [];
}


