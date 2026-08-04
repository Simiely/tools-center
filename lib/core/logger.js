// lib/logger.js - 工具日志:写文件(按天滚动,保留 N 天)+ 内存环形缓冲(最近 N 行)
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./config.js";

const mem = new Map();     // id -> string[](内存最近行)
const streams = new Map(); // id -> WriteStream

function pad(n) { return String(n).padStart(2, "0"); }

function cleanupOld() {
  // 清理超过保留天数的滚动日志 data/logs/<id>-YYYY-MM-DD.log
  try {
    const files = fs.readdirSync(DIRS.logs);
    const cutoff = Date.now() - CONFIG.LOG_KEEP_DAYS * 86400000;
    for (const f of files) {
      const m = f.match(/^(.+)-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!m) continue;
      const d = new Date(m[2]);
      if (!isNaN(d) && d.getTime() < cutoff) {
        try { fs.unlinkSync(path.join(DIRS.logs, f)); } catch {}
      }
    }
  } catch {}
}

/** 首次写入前准备:建目录;若现有日志不是今天则滚动为 <id>-<日期>.log */
function ensure(id) {
  fs.mkdirSync(DIRS.logs, { recursive: true });
  if (!streams.has(id)) {
    const f = path.join(DIRS.logs, id + ".log");
    try {
      const mt = new Date(fs.statSync(f).mtime);
      const today = new Date();
      if (mt.toDateString() !== today.toDateString()) {
        const old = path.join(DIRS.logs, `${id}-${mt.getFullYear()}-${pad(mt.getMonth() + 1)}-${pad(mt.getDate())}.log`);
        try { fs.renameSync(f, old); } catch {}
      }
    } catch { /* 文件不存在,直接新建 */ }
    streams.set(id, fs.createWriteStream(f, { flags: "a" }));
    mem.set(id, []);
    cleanupOld();
  }
  return streams.get(id);
}

/** 挂接子进程 stdout/stderr → 文件 + 内存 */
export function attachLog(tool, child) {
  const st = ensure(tool.id);
  const push = (line) => {
    const l = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    const arr = mem.get(tool.id);
    arr.push(l);
    if (arr.length > CONFIG.LOG_MEM_LINES) arr.shift();
    st.write(l + "\n");
  };
  child.stdout && child.stdout.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(push));
  child.stderr && child.stderr.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(push));
}

/** 读取最近 N 行:优先内存缓冲;服务重启后内存为空 → 回退读日志文件尾部 */
export function readLog(id, lines = CONFIG.LOG_MEM_LINES) {
  const memLines = mem.get(id);
  if (memLines && memLines.length) return memLines.slice(-lines);
  const f = path.join(DIRS.logs, id + ".log");
  try {
    const fd = fs.openSync(f, "r");
    const stat = fs.fstatSync(fd);
    const want = lines * 200; // 每行约 200B 的粗略估计,读多些再截断
    const start = Math.max(0, stat.size - want);
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

/** 工具被删除时调用:关闭文件流、释放内存缓冲(防句柄泄漏) */
export function detachLog(id) {
  try { const st = streams.get(id); if (st) st.end(); } catch {}
  streams.delete(id);
  mem.delete(id);
}
