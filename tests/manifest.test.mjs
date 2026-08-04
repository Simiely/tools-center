// tests/manifest.test.mjs - manifest 解析测试(V1/V2 兼容)
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeManifest } from "../lib/core/manifest.js";

test("V2 manifest:runtime+entry → cmd 数组", () => {
  const m = normalizeManifest({ id: "demo", name: "Demo", runtime: "node", entry: "server.mjs", port: 8150 }, "x");
  assert.equal(m.id, "demo");
  assert.equal(m.type, "app");
  assert.deepEqual(m.cmd, ["node", "server.mjs", "8150"]);
  assert.equal(m.runtime, "node");
});

test("V2 manifest:link 型", () => {
  const m = normalizeManifest({ id: "l", name: "L", type: "link", url: "http://example.com" }, "x");
  assert.equal(m.type, "link");
  assert.equal(m.linkUrl, "http://example.com");
});

test("V1 tool.json:cmd 原样保留,capabilities 为空", () => {
  const m = normalizeManifest({ id: "v1", name: "V1", type: "app", cmd: ["node", "s.mjs", "8101"], port: 8101 }, "x");
  assert.deepEqual(m.cmd, ["node", "s.mjs", "8101"]);
  assert.deepEqual(m.capabilities, []);
});

test("未知能力被标记 unknownCaps 但不阻止", () => {
  const m = normalizeManifest({ id: "x", name: "X", capabilities: ["browser", "foo"] }, "x");
  assert.deepEqual(m.capabilities, ["browser", "foo"]);
  assert.deepEqual(m.unknownCaps, ["foo"]);
});

test("缺省字段有默认值", () => {
  const m = normalizeManifest({}, "fallback");
  assert.equal(m.name, "fallback");
  assert.equal(m.group, "其他");
  assert.equal(m.restart, "always");
});
