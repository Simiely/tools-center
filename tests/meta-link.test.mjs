// tests/meta-link.test.mjs - 应用信息编辑:link 型修改链接(url)写回声明文件
// 独立文件:须在 import 前设置 TOOLS_DIR/DATA_DIR 到临时目录,再动态 import。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-meta-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");

const { initCapabilities } = await import("../lib/capabilities/index.js");
const registry = await import("../lib/core/registry.js");
const disk = await import("../lib/core/disk-ops.js");

await initCapabilities();

after(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

function writeLinkTool(id, url) {
  const dir = path.join(process.env.TOOLS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id, name: id, type: "link", url, icon: "🔗", group: "服务", desc: "跳转",
  }), "utf8");
  registry.scanTools();  // 写文件后重扫注册表(与 disk-ops 测试一致)
  return dir;
}

test("link 型:updateToolMeta 修改 url 写回 tool.json", () => {
  writeLinkTool("jelly", "http://192.168.1.100:8096");
  const t = registry.getTool("jelly");
  assert.ok(t && t.valid, "link 工具应扫描有效");
  const nt = registry.updateToolMeta("jelly", { url: "http://192.168.1.100:8097" });
  assert.equal(nt.type, "link");
  assert.equal(nt.url, "http://192.168.1.100:8097", "返回的 spec.url 应更新");
  const file = path.join(process.env.TOOLS_DIR, "jelly", "tool.json");
  const spec = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(spec.url, "http://192.168.1.100:8097", "tool.json 的 url 应已写回");
});

test("link 型:url 非法(http 前缀缺失)报错且不写盘", () => {
  writeLinkTool("bad", "http://ok.example");
  assert.throws(() => registry.updateToolMeta("bad", { url: "not-a-url" }), /http\(s\)/);
  const spec = JSON.parse(fs.readFileSync(path.join(process.env.TOOLS_DIR, "bad", "tool.json"), "utf8"));
  assert.equal(spec.url, "http://ok.example", "非法 url 不应写盘");
});

test("app 型:updateToolMeta 传 url 应报错(仅 link 型支持)", () => {
  const dir = path.join(process.env.TOOLS_DIR, "appx");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id: "appx", name: "AppX", type: "app", cmd: ["node", "server.mjs"], port: 8150,
  }), "utf8");
  fs.writeFileSync(path.join(dir, "server.mjs"), "// x", "utf8");
  registry.scanTools();
  assert.ok(registry.getTool("appx").valid);
  assert.throws(() => registry.updateToolMeta("appx", { url: "http://x.example" }), /仅 link 型/);
});

test("scanDisk:link 型 item 带 url 字段回填", () => {
  const items = disk.scanDisk();
  const linkItem = items.find(x => x.id === "jelly");
  assert.ok(linkItem, "jelly 应在扫描结果中");
  assert.equal(linkItem.type, "link");
  assert.equal(linkItem.url, "http://192.168.1.100:8097", "scanDisk 应返回 url 供编辑弹窗回填");
  const appItem = items.find(x => x.id === "appx");
  assert.equal(appItem.url, "", "app 型 url 应为空");
});

test("P-1 回归:目录名≠id 的手动工具,scanDisk 应同时暴露 id(编辑提交用 id)", () => {
  // 手动放置:目录名 jelly,工具 id 是 jellyfin(与目录名不同,2026-08-09 走查 P-1)
  const dir = path.join(process.env.TOOLS_DIR, "jelly");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id: "jellyfin", name: "影音库", type: "link", url: "http://192.168.1.100:8096",
  }), "utf8");
  registry.scanTools();
  const items = disk.scanDisk();
  const item = items.find(x => x.dir === "jelly");
  assert.ok(item, "目录 jelly 应出现在 scanDisk");
  assert.equal(item.dir, "jelly", "dir 是目录名");
  assert.equal(item.id, "jellyfin", "id 是工具 id(编辑提交必须用 id,不能用 dir)");
  // 验证用 id 编辑成功(模拟前端 saveMeta 传 metaEditingId)
  const nt = registry.updateToolMeta("jellyfin", { name: "影音库新" });
  assert.equal(nt.name, "影音库新", "用 id 编辑成功");
});
