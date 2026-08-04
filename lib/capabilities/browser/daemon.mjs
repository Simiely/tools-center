// lib/capabilities/browser/daemon.mjs - 浏览器桥 CDP 代理服务
// 由能力模块 browser 懒加载启动(平台进程内起 HTTP server)。
// API 契约(兼容 edge-daemon,供工具 SDK 调用):
//   GET  /status            -> { connected, port, backend }
//   GET  /tabs              -> [{index, targetId, title, url}]
//   GET  /eval?target=0&expr=JS -> Runtime.evaluate 结果(自动 attach)
//   POST /cmd {method,params,targetId?} -> 任意 CDP 命令
//   GET  /newtab?url=...    -> 新开标签页
// 双 backend:
//   DEV  (EDGE_BROWSER_BACKEND=dev,默认): 连接真实 Edge(--remote-debugging-port)
//   PROD (EDGE_BROWSER_BACKEND=headless): spawn headless Chromium 并连接
// 无浏览器时 connected=false 周期重试,不崩溃(工具健康不受影响,仅浏览器功能降级)。
import http from "node:http";
import { spawn } from "node:child_process";

const DEBUG_PORT = parseInt(process.env.EDGE_DEBUG_PORT || "9222", 10);
const BACKEND = String(process.env.EDGE_BROWSER_BACKEND || "dev").toLowerCase();
const CONNECT_TIMEOUT = 25000;
const RETRY_MS = 3000;

let ws = null, connected = false, msgId = 0, backend = BACKEND;
const pending = new Map();
const sessions = new Map();
let headlessProc = null;

async function discoverWsUrl() {
  const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) return null;
  const j = await r.json();
  return j.webSocketDebuggerUrl || null;
}

/** headless backend:拉起 Chromium,等待其调试端口就绪 */
async function startHeadless() {
  if (headlessProc) return;
  const CHROME = process.env.CHROME_PATH
    || (process.platform === "linux" ? "/usr/bin/chromium" : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
  try {
    headlessProc = spawn(CHROME, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`, "--user-data-dir=" + (process.env.EDGE_USER_DATA || "/tmp/cap-browser"),
      "about:blank",
    ], { stdio: "ignore" });
    headlessProc.on("exit", () => { headlessProc = null; });
  } catch (e) {
    console.error("[cap-browser] headless 启动失败:", e.message);
    headlessProc = null;
  }
}

function connect() {
  if (BACKEND === "headless") { try { startHeadless(); } catch {} }
  discoverWsUrl()
    .then((wsUrl) => {
      if (!wsUrl) {
        console.log(`[cap-browser] 浏览器调试端点(:${DEBUG_PORT})不可用,${RETRY_MS / 1000}s 后重试`);
        return setTimeout(connect, RETRY_MS);
      }
      let sock;
      try { sock = new WebSocket(wsUrl); } catch { return setTimeout(connect, RETRY_MS); }
      let opened = false;
      const timer = setTimeout(() => {
        if (!opened) { try { sock.close(); } catch {} }
      }, CONNECT_TIMEOUT);
      sock.onopen = () => { opened = true; clearTimeout(timer); ws = sock; connected = true; console.log("[cap-browser] CONNECTED (" + BACKEND + ")"); };
      sock.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
      sock.onclose = () => { clearTimeout(timer); ws = null; connected = false; sessions.clear(); setTimeout(connect, RETRY_MS); };
      sock.onerror = () => { clearTimeout(timer); try { sock.close(); } catch {} };
    })
    .catch(() => setTimeout(connect, RETRY_MS));
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve) => {
    if (!connected || !ws) return resolve({ error: { message: "not connected" } });
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}

async function getPages() {
  const r = await send("Target.getTargets");
  if (r.error) throw new Error(r.error.message);
  return r.result.targetInfos.filter((t) => t.type === "page");
}

async function attachAndSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const r = await send("Target.attachToTarget", { targetId, flatten: true });
  if (r.error || !r.result) throw new Error((r.error && r.error.message) || "attach failed");
  sessions.set(targetId, r.result.sessionId);
  return r.result.sessionId;
}

export function createBrowserServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
    const handle = async () => {
      try {
        if (url.pathname === "/status") return json(200, { connected, port, backend });
        if (url.pathname === "/tabs") return json(200, await getPages().then((ps) => ps.map((t, i) => ({ index: i, targetId: t.targetId, title: t.title, url: t.url }))).catch((e) => json(500, { error: e.message })));
        if (url.pathname === "/eval") {
          const expr = url.searchParams.get("expr");
          if (!expr) return json(400, { error: "expr required" });
          const target = url.searchParams.get("target") || "0";
          const pages = await getPages();
          const t = /^\d+$/.test(target) ? pages[parseInt(target, 10)] : pages.find((p) => p.targetId === target || p.url.includes(target));
          if (!t) return json(404, { error: "target not found: " + target });
          const sid = await attachAndSession(t.targetId);
          const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sid);
          return json(200, r);
        }
        if (url.pathname === "/cmd" && req.method === "POST") {
          let body = "";
          req.on("data", (c) => { body += c; if (body.length > 1024 * 1024) req.destroy(); }); // 上限 1MB,防滥用
          req.on("end", async () => {
            try {
              const p = JSON.parse(body || "{}");
              const r = p.targetId
                ? await send(p.method, p.params || {}, await attachAndSession(p.targetId))
                : await send(p.method, p.params || {});
              return json(200, r);
            } catch (e) { json(500, { error: e.message }); }
          });
          return;
        }
        if (url.pathname === "/newtab") {
          const r = await send("Target.createTarget", { url: url.searchParams.get("url") || "about:blank" });
          return json(200, r);
        }
        json(404, { error: "unknown path: " + url.pathname });
      } catch (e) { json(500, { error: e.message }); }
    };
    handle();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`[cap-browser] HTTP API ready on http://127.0.0.1:${port} (backend=${BACKEND})`);
      connect();
      resolve(server);
    });
  });
}

export function stopBrowserServer(server) {
  try { if (server) server.close(); } catch {}
  try { if (ws) ws.close(); } catch {}
  try { if (headlessProc) headlessProc.kill(); } catch {}
  connected = false;
}
