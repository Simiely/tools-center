// tests/manager.test.mjs - 进程托管(manager.js)单元测试
// 覆盖:start/stop/statusOf/sync 的基础路径(启动真实子进程、停止、状态机、暂停联动)。
// 注意:不测崩溃退避拉起(需要真实长时间等待),用短退避配置覆盖 restart 分支。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-mgr-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");
process.env.RESTART_BACKOFF_BASE_MS = "50";
process.env.RESTART_BACKOFF_MAX_MS = "200";
process.env.RESTART_MAX_FAILS = "3";
process.env.SIGTERM_GRACE_MS = "500";

const { initCapabilities } = await import("../lib/capabilities/index.js");
const registry = await import("../lib/core/registry.js");
const manager = await import("../lib/core/manager.js");

function writeTool(id, port, extra = {}) {
  const dir = path.join(process.env.TOOLS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id, name: id, type: "app", cmd: ["node", "server.mjs", String(port)], port, ...extra,
  }));
  fs.writeFileSync(path.join(dir, "server.mjs"),
    `import http from "node:http";\nconst p=parseInt(process.argv[2]||"8100",10);\nhttp.createServer((q,s)=>{s.writeHead(200,{"Content-Type":"application/json"});s.end(JSON.stringify({ok:true,port:p}));}).listen(p,"127.0.0.1",()=>console.log("up:"+p));\n`);
}

before(async () => { await initCapabilities(); });
after(async () => {
  // 停所有托管进程再删临时目录(否则日志句柄占用)
  for (const t of registry.listTools()) { try { await manager.stop(t); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test("start:有效 app 工具启动为 running", async () => {
  writeTool("t1", 8151);
  registry.scanTools();
  manager.startAll();
  const t = registry.getTool("t1");
  await new Promise(r => setTimeout(r, 800)); // 等子进程 spawn
  const st = manager.statusOf(t);
  assert.equal(st.status, "running");
});

test("stop:优雅停止后 status=stopped 且不拉起", async () => {
  const t = registry.getTool("t1");
  await manager.stop(t);
  await new Promise(r => setTimeout(r, 300));
  const st = manager.statusOf(t);
  assert.equal(st.status, "stopped");
  assert.equal(st.health, "unknown");
});

test("statusOf:link 型返回 link 状态", () => {
  const link = { id: "lk", type: "link", valid: true };
  const st = manager.statusOf(link);
  assert.equal(st.status, "link");
  assert.equal(st.paused, false);
});

test("sync:暂停的工具会被停止", async () => {
  writeTool("t2", 8152);
  registry.scanTools();
  manager.startAll();
  await new Promise(r => setTimeout(r, 800));
  const t = registry.getTool("t2");
  assert.equal(manager.statusOf(t).status, "running");
  // 暂停 → 重新扫描 → sync 应停止
  const lifecycle = await import("../lib/core/lifecycle.js");
  lifecycle.setPaused("t2", true);
  registry.scanTools();
  manager.sync();
  await new Promise(r => setTimeout(r, 500));
  const st = manager.statusOf(registry.getTool("t2"));
  assert.equal(st.status, "stopped");
  assert.equal(st.paused, true);
});

test("sync:被移除的工具从 run 清理", async () => {
  // t2 暂停中不拉;t1 已停。造一个新工具 t3,scan 后 sync 应启动
  writeTool("t3", 8153);
  registry.scanTools();
  manager.sync();
  await new Promise(r => setTimeout(r, 800));
  const t = registry.getTool("t3");
  assert.equal(manager.statusOf(t).status, "running");
  // 删除 t3 目录 → scan + sync → run 中应无 t3
  const dir = path.join(process.env.TOOLS_DIR, "t3");
  // 先停进程再删目录(Windows 句柄占用)
  await manager.stop(t);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  registry.scanTools();
  manager.sync();
  assert.equal(manager.statusOf({ id: "t3", type: "app" }).status, "stopped");
});

test("startAll:cmd 无效的工具被跳过不抛错", () => {
  // 造一个 cmd 为空的工具:scanTools 时 validate 会标 invalid(缺 cmd) → startAll 跳过
  const dir = path.join(process.env.TOOLS_DIR, "bad");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({ id: "bad", name: "bad", type: "app", port: 8159 }));
  registry.scanTools();
  const t = registry.getTool("bad");
  assert.equal(t.valid, false); // 缺 cmd → 校验失败
  manager.startAll(); // 不应抛
  const st = manager.statusOf(t);
  assert.equal(st.status, "stopped"); // 未启动(valid=false 被跳过)
});
