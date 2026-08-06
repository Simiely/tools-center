// tests/zip-check.test.mjs - zip 缓冲校验单元测试(2026-08-06:下载/上传内容校验,防"解压失败"难定位)
import test from "node:test";
import assert from "node:assert";
import { zipPack } from "../lib/core/zip.js";
import { checkZipBuffer } from "../lib/core/upload.js";

test("checkZipBuffer:标准 zip 通过", () => {
  const buf = zipPack([{ name: "tool.json", data: Buffer.from('{"id":"t1"}', "utf8") }]);
  assert.doesNotThrow(() => checkZipBuffer(buf));
});

test("checkZipBuffer:空内容报明确错误", () => {
  assert.throws(() => checkZipBuffer(Buffer.alloc(0)), /仅 0 字节/);
  assert.throws(() => checkZipBuffer(null), /仅 0 字节/);
});

test("checkZipBuffer:非 zip(网页/文本)报明确错误", () => {
  const html = Buffer.from("<!DOCTYPE html><html>404 Not Found</html>", "utf8");
  assert.throws(() => checkZipBuffer(html), /不是 zip 文件.*魔数/);
  // 文本长度够但魔数不对
  const text = Buffer.alloc(100, 0x61); // 'a'*100
  assert.throws(() => checkZipBuffer(text), /不是 zip 文件/);
});

test("checkZipBuffer:截断 zip(缺 EOCD)报不完整", () => {
  const buf = zipPack([{ name: "a.txt", data: Buffer.from("hello") }]);
  const cut = buf.subarray(0, Math.floor(buf.length / 2)); // 砍掉后半(中央目录+EOCD)
  assert.throws(() => checkZipBuffer(cut), /不完整.*截断/);
});

test("checkZipBuffer:upload.js 纯工具模块可直接用", () => {
  const buf = zipPack([{ name: "x", data: Buffer.from("1") }]);
  assert.doesNotThrow(() => checkZipBuffer(buf));
  assert.throws(() => checkZipBuffer(Buffer.from("not zip content not zip content")), /不是 zip 文件/);
});
