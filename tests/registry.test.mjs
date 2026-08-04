// tests/registry.test.mjs - 注册表校验/归一化测试(不写盘,只测纯函数)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { initCapabilities } from "../lib/capabilities/index.js";
import { validate, validateManifest } from "../lib/core/registry.js";

// 初始化能力注册表(browser/storage/network),否则 checkCapabilities 会把已知能力判为未注册
before(async () => { await initCapabilities(); });

test("validate:合法 V2 manifest 通过", () => {
  const errs = validate({ id: "demo", name: "Demo", runtime: "node", entry: "s.mjs", port: 8150, capabilities: ["storage"] });
  assert.deepEqual(errs, []);
});

test("validate:缺 name 报错", () => {
  assert.ok(validate({ id: "x", port: 8150 }).includes("缺少 name"));
});

test("validate:非法 id 报错", () => {
  assert.ok(validate({ id: "Bad_ID!", name: "X", port: 8150 }).some(e => e.includes("id")));
});

test("validate:端口越界报错", () => {
  assert.ok(validate({ id: "x", name: "X", cmd: ["node", "s.mjs"], port: 9999 }).some(e => e.includes("port")));
});

test("validate:未知能力报错", () => {
  assert.ok(validate({ id: "x", name: "X", cmd: ["node", "s.mjs"], port: 8150, capabilities: ["nope"] }).some(e => e.includes("能力未注册")));
});

test("validate:link 型需要 url", () => {
  assert.ok(validate({ id: "x", name: "X", type: "link" }).some(e => e.includes("url")));
});

test("validateManifest:返回归一化视图", () => {
  const r = validateManifest({ id: "demo", name: "Demo", runtime: "node", entry: "s.mjs", port: 8150 });
  assert.equal(r.ok, true);
  assert.equal(r.normalized.cmd[0], "node");
  assert.equal(r.normalized.type, "app");
});
