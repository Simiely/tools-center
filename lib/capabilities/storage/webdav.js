// lib/capabilities/storage/webdav.js - 平台级 WebDAV 同步(备份/恢复工具数据)
// 配置存平台 data/webdav.json(含密码,仅本机)。备份目录: tools-center/backup
// 复用 credits-tool lib/webdav.js 的协议逻辑,改为平台级(多工具共享一份配置与目标)。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../../core/config.js";

const SYNC_FILE = path.join(DIRS.data, "webdav.json");
export const BACKUP_DIR = "tools-center/backup"; // WebDAV 上备份根目录

export function loadSyncConfig() {
  try { return JSON.parse(fs.readFileSync(SYNC_FILE, "utf8")); } catch { return null; }
}
export function saveSyncConfig(cfg) {
  fs.mkdirSync(path.dirname(SYNC_FILE), { recursive: true });
  fs.writeFileSync(SYNC_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

const auth = (user, pass) => "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

async function req(method, url, user, pass, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: auth(user, pass), ...(body ? { "Content-Type": "application/octet-stream" } : {}) },
      body,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "WebDAV 请求超时(15s)" : "网络错误: " + e.message);
  } finally { clearTimeout(t); }
}

const baseOf = (base) => base.replace(/\/+$/, "");
const fileUrl = (base, dir, file) => `${baseOf(base)}/${dir}/${file}`;

/** 确保备份目录存在:多级目录逐级 MKCOL(201 新建 / 405·301 已存在均成功) */
export async function ensureDir(base, user, pass, dir = BACKUP_DIR) {
  const baseUrl = baseOf(base);
  let acc = "";
  for (const seg of String(dir).split("/").filter(Boolean)) {
    acc += "/" + seg;
    const r = await req("MKCOL", baseUrl + acc + "/", user, pass);
    if (![200, 201, 301, 405].includes(r.status)) throw new Error("创建目录失败(HTTP " + r.status + ")");
  }
}

export async function uploadFile(base, user, pass, dir, file, content) {
  await ensureDir(base, user, pass, dir);
  const r = await req("PUT", fileUrl(base, dir, file), user, pass, content);
  if (r.status >= 200 && r.status < 300) return;
  throw new Error(`上传 ${file} 失败(HTTP ${r.status})`);
}

export async function downloadFile(base, user, pass, dir, file) {
  const r = await req("GET", fileUrl(base, dir, file), user, pass);
  if (r.status === 404) return null;
  if (r.status >= 200 && r.status < 300) return await r.text();
  throw new Error(`下载 ${file} 失败(HTTP ${r.status})`);
}

export async function testConnection(base, user, pass) {
  await ensureDir(base, user, pass);
  return true;
}
