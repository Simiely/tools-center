// lib/core/zip.js - 零依赖 zip 打包/解包(仅用 Node 内置 zlib)
// 用途:工具目录备份(整目录 → zip,勾选工具恢复)。
// 实现:经典 zip 结构 = 若干 Local File Header + 中央目录 + End of Central Directory。
// 压缩:deflateRaw(方法 8),文件名 UTF-8 标记(bit 11),CRC32 用 zlib.crc32。
// 安全:解包时校验每条路径 resolve 后必须落在目标根内(防 zip-slip 穿越)。
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const fs_readdir = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const fs_stat = (p) => { try { return fs.statSync(p); } catch { return { isDirectory: () => false, isFile: () => false }; } };
const fs_read = (p) => { try { return fs.readFileSync(p); } catch { return Buffer.alloc(0); } };
const fs_mkdir = (d) => { try { fs.mkdirSync(d, { recursive: true }); } catch {} };
const fs_write = (p, d) => { try { fs.writeFileSync(p, d); } catch {} };
function dosTime(ms) {
  const d = new Date(ms);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * 打包目录为 zip Buffer。
 * @param {Array<{name:string, data:Buffer, mtime?:number}>} files 扁平文件列表(name 为 zip 内相对路径,用 / 分隔)
 * @returns {Buffer}
 */
export function zipPack(files) {
  const chunks = [];
  const central = []; // 中央目录条目
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = f.data || Buffer.alloc(0);
    const crc = zlib.crc32(data) >>> 0;
    const comp = zlib.deflateRawSync(data);
    const { time, date } = dosTime(f.mtime || Date.now());

    // ---- Local File Header (30 bytes + name) ----
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);       // signature
    lfh.writeUInt16LE(20, 4);               // version needed
    lfh.writeUInt16LE(0x0800, 6);           // flags: UTF-8 文件名
    lfh.writeUInt16LE(8, 8);                // method: deflate
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);     // compressed size
    lfh.writeUInt32LE(data.length, 22);     // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);               // extra len
    chunks.push(lfh, nameBuf, comp);

    // ---- Central Directory entry (46 bytes + name) ----
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);        // signature
    cd.writeUInt16LE(20, 4);                // version made by
    cd.writeUInt16LE(20, 6);                // version needed
    cd.writeUInt16LE(0x0800, 8);            // flags
    cd.writeUInt16LE(8, 10);                // method
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);                // extra len
    cd.writeUInt16LE(0, 32);                // comment len
    cd.writeUInt16LE(0, 34);                // disk number
    cd.writeUInt16LE(0, 36);                // internal attrs
    cd.writeUInt32LE(0, 38);                // external attrs
    cd.writeUInt32LE(offset, 42);           // local header offset
    central.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + comp.length;
  }

  // ---- End of Central Directory (22 bytes) ----
  const centralStart = offset;
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);        // signature
  eocd.writeUInt16LE(0, 4);                 // disk number
  eocd.writeUInt16LE(0, 6);                 // cd start disk
  eocd.writeUInt16LE(files.length, 8);      // entries on disk
  eocd.writeUInt16LE(files.length, 10);     // entries total
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);                // comment len

  return Buffer.concat([...chunks, ...central, eocd]);
}

/**
 * 解析 zip:返回文件列表 {name, data, crc}。校验 CRC32;拒绝目录穿越条目。
 * @param {Buffer} buf
 * @returns {Array<{name:string, data:Buffer}>}
 */
export function zipUnpack(buf) {
  // 定位 EOCD:末尾 22 字节前可带 comment,从后往前找签名
  let eocdIdx = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdIdx = i; break; }
  }
  if (eocdIdx < 0) throw new Error("无效 zip:未找到 EOCD");

  const entryCount = buf.readUInt16LE(eocdIdx + 10);
  if (entryCount > 10000) throw new Error(`zip 条目数超限(${entryCount}>10000),疑似 zip 炸弹`);
  const cdStart = buf.readUInt32LE(eocdIdx + 16);
  const out = [];
  let totalUncomp = 0;
  let pos = cdStart;
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("无效 zip:中央目录损坏");
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");

    // 安全:拒绝绝对路径与 .. 穿越
    if (name.startsWith("/") || name.startsWith("\\")) throw new Error("zip 条目非法(绝对路径): " + name);
    const norm = name.replace(/\\/g, "/");
    const parts = norm.split("/");
    if (parts.some((p) => p === "..")) throw new Error("zip 条目非法(路径穿越): " + name);
    if (norm.endsWith("/")) { pos += 46 + nameLen + extraLen + commentLen; continue; } // 目录条目跳过

    // 读取 Local File Header 处的数据
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("无效 zip:本地头损坏");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    let data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 8) data = zlib.inflateRawSync(data);
    else if (method !== 0) throw new Error("不支持的压缩方式: " + method);
    if (data.length !== uncompSize) throw new Error("zip 条目大小不匹配: " + name);
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error("zip 条目 CRC 校验失败: " + name);
    // zip 炸弹防护(2026-08-06 审计加固):解压总体积上限 200MB
    totalUncomp += data.length;
    if (totalUncomp > 200 * 1024 * 1024) throw new Error(`解压总体积超限(>200MB),疑似 zip 炸弹`);
    out.push({ name: norm, data: Buffer.from(data) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * 把目录打包为 zip(递归,含子目录)。
 * @param {string} dir 要打包的目录
 * @param {string} prefix zip 内前缀(如工具 id,默认取目录名)
 * @returns {Buffer}
 */
export function zipPackDir(dir, prefix) {
  return zipPack(collectDirFiles(dir, prefix || path.basename(dir)));
}

/**
 * 把多个目录打包为**同一个** zip(合并文件列表后一次 zipPack,合法单 zip)。
 * @param {Array<{dir:string, prefix:string}>} roots 每个 {dir, prefix}
 * @returns {Buffer}
 */
export function zipPackDirs(roots) {
  const files = [];
  for (const { dir, prefix } of roots) files.push(...collectDirFiles(dir, prefix));
  return zipPack(files);
}

/** 递归收集目录文件为 {name, data, mtime} 列表 */
function collectDirFiles(dir, base) {
  const files = [];
  (function walk(cur, rel) {
    for (const name of fs_readdir(cur)) {
      const p = path.join(cur, name);
      const s = fs_stat(p);
      const zipName = (rel ? rel + "/" : "") + name;
      if (s.isDirectory()) walk(p, zipName);
      else if (s.isFile()) files.push({ name: base + "/" + zipName, data: fs_read(p), mtime: s.mtimeMs });
    }
  })(dir, "");
  return files;
}

/** 从 zip 解出所有条目到目标目录(自动建子目录,防穿越已在 zipUnpack 校验) */
export function zipUnpackDir(buf, destDir) {
  const entries = zipUnpack(buf);
  for (const e of entries) {
    const target = path.resolve(destDir, e.name);
    if (!target.startsWith(path.resolve(destDir) + path.sep)) throw new Error("路径越界: " + e.name);
    fs_mkdir(path.dirname(target));
    fs_write(target, e.data);
  }
  return entries.map((e) => e.name);
}
