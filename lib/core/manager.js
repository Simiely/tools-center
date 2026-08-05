// lib/manager.js - 进程托管(仅 app 型):spawn / 崩溃退避拉起 / 优雅停止 / 健康检查
// 设计:运行时状态(进程/健康/退避)统一存在 run Map,与 registry 的 ToolSpec(纯配置)解耦。
// registry 重扫(scanTools)重建 spec 时,运行状态不受影响。
import { spawn } from "node:child_process";
import path from "node:path";
import { CONFIG } from "./config.js";
import { listTools } from "./registry.js";
import { attachLog, detachLog } from "./logger.js";

// id -> { proc, retries, timer, stopped, status, health, error }
const run = new Map();

function newRec(tool) {
  return { proc: null, retries: 0, timer: null, stopped: false, status: "stopped", health: "unknown", error: "" };
}

function start(tool) {
  if (tool.type !== "app" || !tool.valid) return;
  if (tool.paused) return; // 已暂停:不自动启动
  const rec = run.get(tool.id) || newRec(tool);
  if (rec.proc) return; // 已在运行
  run.set(tool.id, rec);
  rec.status = "starting";
  rec.error = "";
  // 防御:cmd 异常(空/非数组)时标记 error 但不抛——避免一个坏工具中断 startAll 循环
  if (!Array.isArray(tool.cmd) || !tool.cmd.length || typeof tool.cmd[0] !== "string") {
    rec.status = "error";
    rec.error = "cmd 配置无效";
    return;
  }
  // cmd[0] 为 "node" 时用中心自身的 node 可执行文件(避免依赖 PATH,保证可移植)
  const argv0 = tool.cmd[0];
  const args = tool.cmd.slice(1);
  const exe = (argv0 === "node" || argv0 === "node.exe") ? process.execPath : argv0;
  let child;
  try {
    child = spawn(exe, args, {
      cwd: path.join(tool.dir, tool.cwd),
      env: { ...process.env, ...tool.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    rec.status = "error";
    rec.error = e.message;
    return;
  }
  rec.proc = child;
  attachLog(tool, child);

  child.on("spawn", () => { rec.status = "running"; rec.health = "unknown"; });
  child.on("error", (e) => {
    rec.status = "error";
    rec.error = e.message;
    rec.proc = null;
  });
  child.on("exit", (code) => {
    rec.proc = null;
    if (rec.stopped) { rec.status = "stopped"; return; } // 手动停止,不拉起
    const shouldRestart = tool.restart === "always" || (tool.restart === "on-failure" && code !== 0);
    if (!shouldRestart) { rec.status = "stopped"; return; }
    rec.retries += 1;
    if (rec.retries > CONFIG.RESTART_MAX_FAILS) {
      rec.status = "error";
      rec.error = `连续启动失败 ${rec.retries} 次,已停止拉起`;
      return;
    }
    const delay = Math.min(CONFIG.RESTART_BACKOFF_BASE_MS * 2 ** (rec.retries - 1), CONFIG.RESTART_BACKOFF_MAX_MS);
    rec.status = `restarting(${rec.retries})`;
    rec.timer = setTimeout(() => { rec.timer = null; start(tool); }, delay);
  });
}

/** 优雅停止:SIGTERM → 5s 未退出则 SIGKILL */
export function stop(tool) {
  return new Promise((resolve) => {
    const rec = run.get(tool.id);
    if (!rec || !rec.proc) {
      if (rec) { rec.status = "stopped"; if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; } }
      return resolve();
    }
    rec.stopped = true; // 阻止 exit 回调自动拉起
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    const p = rec.proc;
    rec.status = "stopping";
    const grace = setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      setTimeout(() => resolve(), 300); // 留时间给 exit
    }, CONFIG.SIGTERM_GRACE_MS);
    p.once("exit", () => { clearTimeout(grace); resolve(); });
    try { p.kill("SIGTERM"); } catch { resolve(); }
  });
}

/** 启动全部有效 app 型工具 */
export function startAll() {
  for (const t of listTools()) if (t.type === "app" && t.valid) start(t);
}

/** reload 后同步:新增的启动,被删的停止,暂停的停止且不拉起 */
export function sync() {
  const alive = new Set(listTools().filter((t) => t.type === "app" && t.valid).map((t) => t.id));
  for (const [id, rec] of run) {
    if (!alive.has(id)) {
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      if (rec.proc) {
        try { rec.proc.kill("SIGKILL"); } catch {}
        rec.stopped = true;
      }
      detachLog(id); // 释放日志句柄与内存缓冲
      run.delete(id);
      continue;
    }
    // 已暂停但还在运行:立即停止(不自动拉起由 start 的 paused 判断保证)
    const t = listTools().find((x) => x.id === id);
    if (t && t.paused && rec.proc) {
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      rec.stopped = true;
      try { rec.proc.kill("SIGTERM"); } catch {}
      rec.status = "stopped";
      rec.proc = null;
    }
  }
  startAll();
}

export async function restart(tool) {
  await stop(tool);
  run.delete(tool.id);
  start(tool);
}

/** 健康检查轮询:对 running 且声明 health 的工具 GET http://127.0.0.1:<port><health> */
export function startHealthLoop() {
  setInterval(healthCheck, CONFIG.HEALTH_INTERVAL_MS);
  setTimeout(healthCheck, 1500); // 启动后先探一次
}
async function healthCheck() {
  for (const t of listTools()) {
    if (t.type !== "app" || !t.valid || !t.health) continue;
    const rec = run.get(t.id);
    if (!rec || !rec.proc) { if (rec) rec.health = "down"; continue; }
    const url = `http://127.0.0.1:${t.port}${t.health}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.HEALTH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      rec.health = r.ok ? "ok" : "down";
    } catch {
      rec.health = "down";
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 对外状态视图(从 run 读取,与 spec 解耦) */
export function statusOf(tool) {
  if (tool.type === "link") return { id: tool.id, status: tool.valid ? "link" : "invalid", health: "unknown", error: "", paused: false };
  const rec = run.get(tool.id);
  return {
    id: tool.id,
    status: rec ? rec.status : "stopped",
    health: rec ? rec.health : "unknown",
    error: rec ? rec.error : "",
    paused: !!tool.paused,
  };
}
