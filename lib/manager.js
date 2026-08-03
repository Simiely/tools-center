// lib/manager.js - 进程托管(仅 app 型):spawn / 崩溃退避拉起 / 优雅停止 / 健康检查
import { spawn } from "node:child_process";
import path from "node:path";
import { CONFIG } from "./config.js";
import { listTools } from "./registry.js";
import { attachLog } from "./logger.js";

const run = new Map(); // id -> { proc, retries, timer, stopped }

function start(tool) {
  if (tool.type !== "app" || !tool.valid) return;
  const rec = run.get(tool.id);
  if (rec && rec.proc) return; // 已在运行
  tool.state.status = "starting";
  tool.state.error = "";
  // cmd[0] 为 "node" 时用中心自身的 node 可执行文件(避免依赖 PATH,保证可移植)
  const argv0 = tool.cmd[0];
  const args = tool.cmd.slice(1);
  const exe = (argv0 === "node" || argv0 === "node.exe") ? process.execPath : argv0;
  const child = spawn(exe, args, {
    cwd: path.join(tool.dir, tool.cwd),
    env: { ...process.env, ...tool.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const r = { proc: child, retries: rec ? rec.retries : 0, timer: null, stopped: false };
  run.set(tool.id, r);
  attachLog(tool, child);

  child.on("spawn", () => {
    tool.state.status = "running";
    tool.state.health = "unknown";
  });
  child.on("error", (e) => {
    tool.state.status = "error";
    tool.state.error = e.message;
    r.proc = null;
  });
  child.on("exit", (code) => {
    r.proc = null;
    if (r.stopped) { tool.state.status = "stopped"; return; } // 手动停止,不拉起
    const shouldRestart = tool.restart === "always" || (tool.restart === "on-failure" && code !== 0);
    if (!shouldRestart || tool.restart === "no") { tool.state.status = "stopped"; return; }
    r.retries += 1;
    if (r.retries > CONFIG.RESTART_MAX_FAILS) {
      tool.state.status = "error";
      tool.state.error = `连续启动失败 ${r.retries} 次,已停止拉起`;
      return;
    }
    const delay = Math.min(CONFIG.RESTART_BACKOFF_BASE_MS * 2 ** (r.retries - 1), CONFIG.RESTART_BACKOFF_MAX_MS);
    tool.state.status = `restarting(${r.retries})`;
    r.timer = setTimeout(() => { r.timer = null; start(tool); }, delay);
  });
}

/** 优雅停止:SIGTERM → 5s 未退出则 SIGKILL */
function stop(tool) {
  return new Promise((resolve) => {
    const rec = run.get(tool.id);
    if (!rec || !rec.proc) {
      tool.state.status = "stopped";
      if (rec && rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      return resolve();
    }
    rec.stopped = true; // 阻止 exit 回调自动拉起
    if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    const p = rec.proc;
    tool.state.status = "stopping";
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

/** reload 后同步:新增的启动,被删的停止 */
export function sync() {
  const alive = new Set(listTools().filter((t) => t.type === "app" && t.valid).map((t) => t.id));
  for (const [id, rec] of run) {
    if (!alive.has(id)) {
      const fake = { id, type: "app", state: { status: rec.proc ? "stopping" : "stopped" } };
      if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
      if (rec.proc) {
        try { rec.proc.kill("SIGKILL"); } catch {}
        rec.stopped = true;
      }
      run.delete(id);
      void fake;
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
    if (!rec || !rec.proc) { t.state.health = "down"; continue; }
    const url = `http://127.0.0.1:${t.port}${t.health}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.HEALTH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      t.state.health = r.ok ? "ok" : "down";
    } catch {
      t.state.health = "down";
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 对外状态视图(无内部引用) */
export function statusOf(tool) {
  const rec = run.get(tool.id);
  return {
    id: tool.id,
    status: tool.type === "link" ? (tool.valid ? "link" : "invalid") : tool.state.status,
    health: tool.type === "link" ? "unknown" : tool.state.health,
    error: tool.state.error || "",
  };
}
