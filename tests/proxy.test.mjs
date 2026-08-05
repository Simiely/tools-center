// tests/proxy.test.mjs - 反向代理(proxy.js)单元测试
// 覆盖:link 型 302 跳转、未知工具 404、无效工具 500、HTML __BASE__ 注入、上游不可达 502。
// 需要真实 HTTP 请求(启动本地工具进程),端口从 8300 段取。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-px-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");

const { initCapabilities } = await import("../lib/capabilities/index.js");
const registry = await import("../lib/core/registry.js");
const manager = await import("../lib/core/manager.js");
const { proxyRequest } = await import("../lib/core/proxy.js");

function writeAppTool(id, port, html) {
  const dir = path.join(process.env.TOOLS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id, name: id, type: "app", cmd: ["node", "server.mjs", String(port)], port, health: "/health",
  }));
  fs.writeFileSync(path.join(dir, "server.mjs"), `import http from "node:http";
const p=parseInt(process.argv[2]||"8300",10);
http.createServer((q,s)=>{
  if (q.url.startsWith("/health")) { s.writeHead(200,{"Content-Type":"application/json"}); return s.end(JSON.stringify({ok:true})); }
  s.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  s.end(${JSON.stringify(html)});
}).listen(p,"127.0.0.1");`);
}

/** 真实请求入口:通过内置 http server 模拟入站请求再调 proxyRequest */
function doProxy(pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1:9");
      proxyRequest(req, res, url);
    });
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      const r = http.request({ host: "127.0.0.1", port, path: pathname, method }, (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          srv.close();
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      });
      r.on("error", (e) => { srv.close(); reject(e); });
      r.end();
    });
  });
}

before(async () => {
  await initCapabilities();
  writeAppTool("px-app", 8151, "<html><head><title>测试</title></head><body>hello</body></html>");
  writeAppTool("px-bad", 8152, "<html></html>"); // 配置无效:同端口冲突
  writeAppTool("px-bad2", 8152, "<html></html>"); // 与 px-bad 冲突 → invalid
  const linkDir = path.join(process.env.TOOLS_DIR, "px-link");
  fs.mkdirSync(linkDir, { recursive: true });
  fs.writeFileSync(path.join(linkDir, "tool.json"), JSON.stringify({
    id: "px-link", name: "link", type: "link", url: "https://example.com/base",
  }));
  registry.scanTools();
  manager.startAll();
  await new Promise(r => setTimeout(r, 800));
});
after(async () => {
  for (const t of registry.listTools()) { try { await manager.stop(t); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test("proxy:link 型 302 跳转", async () => {
  const r = await doProxy("/tool/px-link/abc?x=1");
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "https://example.com/base/abc?x=1");
});

test("proxy:未知工具返回 404", async () => {
  const r = await doProxy("/tool/no-such-tool/");
  assert.equal(r.status, 404);
  assert.match(r.body, /tool not found/);
});

test("proxy:非 /tool 路径返回 false(不处理)", async () => {
  const req = { method: "GET" };
  const res = { writeHead: () => { throw new Error("不应调用"); }, end: () => {} };
  const url = new URL("http://x/api/tools");
  assert.equal(proxyRequest(req, res, url), false);
});

test("proxy:无效工具返回 500", async () => {
  const r = await doProxy("/tool/px-bad2/");
  assert.equal(r.status, 500);
  assert.match(r.body, /配置无效/);
});

test("proxy:HTML 响应注入 __BASE__", async () => {
  const r = await doProxy("/tool/px-app/");
  assert.equal(r.status, 200);
  assert.match(r.body, /window\.__BASE__="\/tool\/px-app"/);
  assert.match(r.body, /hello/);
});

test("proxy:上游不可达返回 502", async () => {
  // 造一个 port 无进程监听的合法工具
  writeAppTool("px-dead", 8159, "<html></html>");
  registry.scanTools();
  const r = await doProxy("/tool/px-dead/");
  assert.equal(r.status, 502);
  assert.match(r.body, /上游不可达/);
});
