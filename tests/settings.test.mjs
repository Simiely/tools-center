// tests/settings.test.mjs - 功能开关(settings.js + 路由过滤)单元测试
// 独立文件:须在 import 前设置 TOOLS_DIR/DATA_DIR 到临时目录,再动态 import。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-settings-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");

const settings = await import("../lib/core/settings.js");
const modules = await import("../lib/core/modules.js");
const routesMod = await import("../lib/routes/index.js");

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });

test("getModules:默认全部开启", () => {
  const m = settings.getModules();
  for (const k of Object.keys(modules.MODULE_DEFAULTS)) {
    assert.equal(m[k], true, k + " 默认应开启");
  }
});

test("setModules:更新并落盘持久化(再读一致)", () => {
  const next = settings.setModules({ storage: false, webdav: true });
  assert.equal(next.storage, false);
  assert.equal(next.webdav, true);
  assert.equal(next.backup, true, "未指定的沿用默认");
  // 重新 getModules 应读到落盘值
  const again = settings.getModules();
  assert.equal(again.storage, false, "落盘后 storage 应为 false");
  // 恢复
  settings.setModules({ storage: true });
});

test("setModules:忽略未知模块键", () => {
  const next = settings.setModules({ unknown: false, storage: true });
  assert.ok(!("unknown" in next), "未知模块不应出现");
});

test("路由快照:全开时含全部模块路由 + settings 主干恒在", () => {
  settings.setModules({ storage: true, backup: true, webdav: true, auth: true, capabilities: true, import: true });
  const paths = routesMod.routes.map(r => r.p || r.prefix || r.re);
  assert.ok(paths.some(p => p === "/api/admin/disk"), "storage 路由应注册");
  assert.ok(paths.some(p => p === "/api/tools/import"), "import 路由应注册");
  assert.ok(paths.some(p => p === "/api/admin/settings"), "settings 路由(主干)恒注册");
  assert.ok(paths.some(p => p === "/api/tools"), "主干 CRUD 路由应注册");
});

test("env 覆盖:MODULES_STORAGE=0 优先于文件", () => {
  process.env.MODULES_STORAGE = "0";
  const m = settings.getModules();
  assert.equal(m.storage, false, "env 应覆盖");
  delete process.env.MODULES_STORAGE;
});
