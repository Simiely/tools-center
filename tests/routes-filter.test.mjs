// tests/routes-filter.test.mjs - 路由按模块开关过滤(env 在 import 前设置,模拟"重启后生效")
// 独立文件:须在 import 前设置 TOOLS_DIR/DATA_DIR + 目标 env,再动态 import index.js。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-rfilter-"));
process.env.TOOLS_DIR = path.join(tmp, "tools");
process.env.DATA_DIR = path.join(tmp, "data");
// 模拟"设置里关了 storage + auth + import 后重启"
process.env.MODULES_STORAGE = "0";
process.env.MODULES_AUTH = "0";
process.env.MODULES_IMPORT = "0";

const { routes } = await import("../lib/routes/index.js");
const paths = routes.map(r => r.p || r.prefix || r.re);

after(() => {
  delete process.env.MODULES_STORAGE;
  delete process.env.MODULES_AUTH;
  delete process.env.MODULES_IMPORT;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test("关闭 storage/auth/import 后:对应路由消失", () => {
  assert.ok(!paths.some(p => p === "/api/admin/disk"), "storage 关 → disk 路由消失");
  assert.ok(!paths.some(p => p === "/api/admin/pass"), "auth 关 → pass 路由消失");
  assert.ok(!paths.some(p => p === "/api/tools/import"), "import 关 → import 路由消失");
  assert.ok(!paths.some(p => p === "/api/files"), "import 关 → 文件上传路由消失");
});

test("主干路由恒在(工具托管/静态/设置)", () => {
  assert.ok(paths.some(p => p === "/api/tools"), "CRUD 恒在");
  assert.ok(paths.some(p => p === "/api/reload"), "reload 恒在");
  assert.ok(paths.some(p => p === "/api/admin/settings"), "settings 恒在(关 auth 后仍能开回)");
  assert.ok(paths.some(p => p === "/"), "首页恒在");
  assert.ok(paths.some(p => p === "/js/"), "静态 js 恒在");
});
