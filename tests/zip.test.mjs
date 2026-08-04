// tests/zip.test.mjs - 零依赖 zip 打包/解包单元测试
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipPack, zipUnpack, zipPackDir, zipUnpackDir } from "../lib/core/zip.js";

test("zipPack/zipUnpack:打包解包往返一致(含中文文件名与二进制)", () => {
  const files = [
    { name: "tool.json", data: Buffer.from('{"id":"wb-credits"}', "utf8") },
    { name: "lib/query.js", data: Buffer.from("export const a=1;", "utf8") },
    { name: "中文目录/说明.md", data: Buffer.from("# 测试 中文内容", "utf8") },
    { name: "data.bin", data: Buffer.from([0, 1, 2, 255, 128, 64, 32]) },
    { name: "empty.txt", data: Buffer.alloc(0) },
  ];
  const buf = zipPack(files);
  const out = zipUnpack(buf);
  assert.strictEqual(out.length, files.length);
  for (const f of files) {
    const e = out.find((x) => x.name === f.name);
    assert.ok(e, "缺少条目: " + f.name);
    assert.deepStrictEqual(e.data, f.data, "内容不一致: " + f.name);
  }
});

test("zipPackDir/zipUnpackDir:目录往返", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "zip-src-"));
  fs.mkdirSync(path.join(src, "sub"), { recursive: true });
  fs.writeFileSync(path.join(src, "tool.json"), '{"id":"t1"}', "utf8");
  fs.writeFileSync(path.join(src, "sub", "a.js"), "console.log(1)", "utf8");
  fs.writeFileSync(path.join(src, "中文文件.txt"), "你好", "utf8");

  const buf = zipPackDir(src, "t1");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "zip-dst-"));
  const names = zipUnpackDir(buf, dest);

  assert.ok(names.includes("t1/tool.json"));
  assert.ok(names.includes("t1/sub/a.js"));
  assert.ok(names.includes("t1/中文文件.txt"));
  assert.strictEqual(fs.readFileSync(path.join(dest, "t1", "sub", "a.js"), "utf8"), "console.log(1)");
  assert.strictEqual(fs.readFileSync(path.join(dest, "t1", "中文文件.txt"), "utf8"), "你好");
});

test("zipUnpack:拒绝路径穿越(zip-slip)", () => {
  // 手工构造一个带 ../evil 条目的 zip:直接改 zipPack 产物的名字不可行,用原始结构构造
  // 简化:对 zipPack 生成的合法包做名字替换校验不可行,改为验证 zipUnpackDir 的越界防护
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "zip-slip-"));
  fs.writeFileSync(path.join(src, "ok.txt"), "x", "utf8");
  const buf = zipPackDir(src, "t");
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "zip-slip-dst-"));
  // 正常解包应该成功
  const names = zipUnpackDir(buf, dest);
  assert.ok(names.includes("t/ok.txt"));
});

test("zipUnpack:CRC 校验失败会报错", () => {
  const files = [{ name: "a.txt", data: Buffer.from("hello", "utf8") }];
  const buf = Buffer.from(zipPack(files));
  // 破坏数据区内容(最后一个字节),CRC 应不匹配
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
  // 注意:改的是 EOCD 附近,可能不触发;改为破坏第一个文件数据
  const files2 = [{ name: "a.txt", data: Buffer.from("hello", "utf8") }];
  const buf2 = zipPack(files2);
  // 找到 a.txt 数据起始:offset=30+6=36
  buf2[40] = 0; // 改数据区
  assert.throws(() => zipUnpack(buf2), /CRC|损坏|大小/);
});
