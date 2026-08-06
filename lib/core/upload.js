// lib/core/upload.js - 文件上传与解压(平台零依赖,手写最小 multipart 解析)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 上传体积上限 100MB
const MAX_EXTRACT_BYTES = 500 * 1024 * 1024;      // 解压后总体积上限 500MB(zip 炸弹防护)

/** 校验 zip 缓冲(魔数 + EOCD 完整性),下载截断/文件损坏/网络劫持时给出明确原因,而非笼统"解压失败"。
 *  标准 zip:开头 PK\x03\x04(空 zip PK\x05\x06 / 分卷 PK\x07\x08),末尾 22 字节内必有 EOCD(PK\x05\x06,可带最长 64KB 注释)。 */
export function checkZipBuffer(buf) {
  const n = (buf && buf.length) || 0;
  if (n < 22) throw new Error(`上传/下载内容无效(仅 ${n} 字节),可能文件损坏或传输中断`);
  const pk = buf[0] === 0x50 && buf[1] === 0x4b;
  const sigOk = pk && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) && buf[3] === 0x04;
  if (!sigOk) throw new Error(`上传/下载内容不是 zip 文件(开头魔数 ${buf.subarray(0, 4).toString("hex")},可能文件损坏或传成了网页/其他格式)`);
  let eocd = -1;
  const tailStart = Math.max(0, n - 22 - 65535);
  for (let i = n - 22; i >= tailStart; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`上传/下载的 zip 不完整(缺少末尾目录,共 ${n} 字节,疑似被截断)`);
}

/** 递归统计目录总体积 */
function dirSize(dir) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const s = fs.statSync(p);
      total += s.isDirectory() ? dirSize(p) : s.size;
      if (total > MAX_EXTRACT_BYTES) break; // 提前退出,防超大目录卡死
    }
  } catch {}
  return total;
}

/** 异步解压:Windows 用 PowerShell Expand-Archive,Linux 用 unzip(不阻塞事件循环);解压后校验体积防 zip 炸弹 */
export async function unzipAsync(zipPath, destDir) {
  const before = dirSize(destDir); // 解压前目录体积(可能已有文件,差值即解压增量)
  const cmd = process.platform === "win32" ? "powershell" : "unzip";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-Command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`]
    : ["-o", "-q", zipPath, "-d", destDir];
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`解压失败 exit=${code}`)));
  });
  // zip 炸弹防护:解压增量超限则清理并报错(删除 zip 与解压产物由调用方 catch 处理)
  const after = dirSize(destDir);
  if (after - before > MAX_EXTRACT_BYTES) {
    throw new Error(`解压体积超限(>${Math.round(MAX_EXTRACT_BYTES / 1024 / 1024)}MB),已中止`);
  }
}

/** 解析相对路径到 tools/data 根,防目录穿越;非法返回 null */
export function resolveWithinRoot(rel) {
  const dest = path.resolve(DIRS.tools, "..", rel);
  const root = path.resolve(DIRS.tools, "..");
  if (dest !== root && !dest.startsWith(root + path.sep)) return null;
  return dest;
}

/**
 * 在解压目录内定位工具声明文件(tool.json / manifest.json)。
 * 规则:优先顶层;否则在子目录里找(限一层,兼容"zip 带顶层文件夹"的常见打包方式)。
 * @param {string} dir 解压根目录
 * @returns {{ manifestPath: string|null, toolRoot: string|null }} manifestPath=声明文件绝对路径;toolRoot=工具内容根目录(含 tool.json 的那一层)
 */
export function findManifest(dir) {
  const names = ["tool.json", "manifest.json"];
  for (const n of names) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) return { manifestPath: p, toolRoot: dir };
  }
  let sub = null;
  try {
    sub = fs.readdirSync(dir).find((name) => {
      const p = path.join(dir, name);
      return fs.statSync(p).isDirectory();
    });
  } catch {}
  if (sub) {
    for (const n of names) {
      const p = path.join(dir, sub, n);
      if (fs.existsSync(p)) return { manifestPath: p, toolRoot: path.join(dir, sub) };
    }
  }
  return { manifestPath: null, toolRoot: null };
}

/** 收集请求体(字节流,带体积上限) */
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      chunks.push(c);
      total += c.length;
      if (total > MAX_UPLOAD_BYTES) { reject(new Error("请求体过大(>100MB)")); req.destroy(); }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * 解析 multipart/form-data(最小实现,兼容带引号 boundary)。
 * @returns {Promise<{fields: Object<string,string>, files: Array<{name,filename,data:Buffer}>}>}
 */
export async function parseMultipart(req, contentType) {
  const bm = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = "--" + (bm ? (bm[1] || bm[2] || "").trim() : "");
  if (!boundary) throw new Error("缺少 boundary");
  const buf = await readBody(req);
  const sep = Buffer.from(boundary);
  const parts = [];
  let idx = buf.indexOf(sep);
  while (idx !== -1) {
    const next = buf.indexOf(sep, idx + sep.length);
    if (next === -1) break;
    parts.push(buf.subarray(idx + sep.length, next));
    idx = next;
  }
  const fields = {};
  const files = [];
  for (const part of parts) {
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd === -1) continue;
    const header = part.subarray(0, headEnd).toString("utf8");
    const body = part.subarray(headEnd + 4);
    const nm = header.match(/name="([^"]+)"/);
    if (!nm) continue;
    const fm = header.match(/filename="([^"]*)"/);
    if (fm) files.push({ name: nm[1], filename: fm[1], data: body });
    else fields[nm[1]] = body.toString("utf8").trim();
  }
  return { fields, files };
}
