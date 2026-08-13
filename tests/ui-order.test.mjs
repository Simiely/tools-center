// tests/ui-order.test.mjs - UI 排序偏好模块测试(分组顺序/组内卡片顺序)
// 用临时 DATA_DIR 隔离文件写入:必须在 import ui-order 前设置 env(config 加载时读取),
// 故本文件只用动态 import(不静态引用 ui-order)。
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uiorder-"));
process.env.DATA_DIR = tmp;
const { loadUiOrder, saveUiOrder, normalizeUiOrder } = await import("../lib/core/ui-order.js");

test("normalizeUiOrder:非对象/空输入返回空结构", () => {
  assert.deepEqual(normalizeUiOrder(null), { groupOrder: [], toolOrder: {} });
  assert.deepEqual(normalizeUiOrder("x"), { groupOrder: [], toolOrder: {} });
  assert.deepEqual(normalizeUiOrder([]), { groupOrder: [], toolOrder: {} });
});

test("normalizeUiOrder:合法结构保留", () => {
  const out = normalizeUiOrder({
    groupOrder: ["监控", "工具"],
    toolOrder: { 监控: ["wb-credits", "edge-daemon"], 工具: ["gh-release-center"] },
  });
  assert.deepEqual(out.groupOrder, ["监控", "工具"]);
  assert.deepEqual(out.toolOrder["监控"], ["wb-credits", "edge-daemon"]);
});

test("normalizeUiOrder:非法 id / 非法 toolOrder 值被过滤", () => {
  const out = normalizeUiOrder({
    groupOrder: ["a", 123, "", "bb".repeat(40)], // 数字/空/超长(>64)丢弃
    toolOrder: { g: ["ok-tool", "../evil", "BAD_ID!", 42] }, // 仅 [a-z0-9-] 保留
  });
  assert.deepEqual(out.groupOrder, ["a"]);
  assert.deepEqual(out.toolOrder.g, ["ok-tool"]);
});

test("saveUiOrder → loadUiOrder 往返一致", () => {
  const order = { groupOrder: ["工具", "监控"], toolOrder: { 工具: ["a1", "b2"], 监控: ["c3"] } };
  saveUiOrder(order);
  assert.deepEqual(loadUiOrder(), order);
});

test("saveUiOrder:超限(>64KB)拒绝", () => {
  const big = { groupOrder: [], toolOrder: {} };
  for (let i = 0; i < 2000; i++) big.groupOrder.push("g".repeat(60) + i); // 每个 ~65 字符 × 2000 ≈ 130KB
  assert.throws(() => saveUiOrder(big), /过大/);
});

test("loadUiOrder:文件损坏返回空结构", () => {
  fs.writeFileSync(path.join(tmp, "ui-order.json"), "{ broken json", "utf8");
  assert.deepEqual(loadUiOrder(), { groupOrder: [], toolOrder: {} });
  saveUiOrder({}); // 恢复干净文件,避免影响其他用例
});

test("loadUiOrder:无文件返回空结构", () => {
  fs.rmSync(path.join(tmp, "ui-order.json"), { force: true });
  assert.deepEqual(loadUiOrder(), { groupOrder: [], toolOrder: {} });
});
