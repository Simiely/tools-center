// tests/registry-ghost.test.mjs - 幽灵工具删除兜底(幂等删除,写盘测试)
// 场景:前端卡片存在但注册表查不到该 id(工具配置损坏 / 目录被外部移除 / 挂载失效)。
// 修复:removeTool 对幽灵 id 幂等删除——目录存在则物理删,不存在则视为已删除,不再抛"工具不存在"。
// 独立文件:须在 import 前设置 TOOLS_DIR/DATA_DIR 到临时目录,再用动态 import(保证 config 读到测试目录)。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-ghost-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");

const registry = await import("../lib/core/registry.js");
const { initCapabilities } = await import("../lib/capabilities/index.js");

before(async () => { await initCapabilities(); });
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test("删除幽灵工具(目录不存在):幂等返回成功,不抛错", () => {
  const r = registry.removeTool("ghost-no-dir");
  assert.equal(r.removed, true);
  assert.equal(r.dirKept, false);
  assert.equal(r.ghost, true, "幽灵删除应标记 ghost=true");
});

test("删除幽灵工具(目录存在但未进注册表):物理删除目录", () => {
  const dir = path.join(process.env.TOOLS_DIR, "ghost-dir");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "x.txt"), "hi");
  const r = registry.removeTool("ghost-dir");
  assert.equal(r.removed, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(r.ghost, true, "幽灵删除应标记 ghost=true");
});

test("删除已托管工具(正常路径):仍然有效且不标记 ghost", () => {
  // 造一个合法工具:目录 + tool.json
  const dir = path.join(process.env.TOOLS_DIR, "normal-tool");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({
    id: "normal-tool", name: "正常工具", type: "app",
    cmd: ["node", "server.mjs"], port: 8150,
  }));
  registry.scanTools();
  const r = registry.removeTool("normal-tool");
  assert.equal(r.removed, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(r.ghost, undefined, "正常删除不应标记 ghost");
});
