// tests/auth.test.mjs - 密码模块测试
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

// 用临时 DIRS 环境:直接 patch 数据目录不可行(config 是 const),改为验证纯函数 hash/check 逻辑
// 方法:构造临时目录 + 用动态 import 重载不可靠,这里只测不依赖文件系统的部分
import { hashPass, scryptHash } from "../lib/core/auth.js";

test("hashPass:相同输入产生相同摘要", () => {
  assert.equal(hashPass("abc"), hashPass("abc"));
});

test("hashPass:不同输入摘要不同", () => {
  assert.notEqual(hashPass("abc"), hashPass("abd"));
});

test("hashPass:sha256 长度 64", () => {
  assert.match(hashPass("x"), /^[0-9a-f]{64}$/);
});

test("hashPass:非字符串输入安全转字符串", () => {
  assert.equal(hashPass(123), hashPass("123"));
});

// v0.13.0:密码哈希升级 scrypt(OWASP 要求慢哈希+盐;兼容旧 sha256 格式)
test("scryptHash:同 pass 同 salt 输出一致(确定性)", () => {
  assert.equal(scryptHash("abc", "a1b2c3"), scryptHash("abc", "a1b2c3"));
});

test("scryptHash:不同 salt 输出不同(盐生效)", () => {
  assert.notEqual(scryptHash("abc", "salt-one"), scryptHash("abc", "salt-two"));
});

test("scryptHash:不同密码输出不同", () => {
  assert.notEqual(scryptHash("abc", "s"), scryptHash("abd", "s"));
});

test("scryptHash:长度 64(32 字节 hex)", () => {
  assert.match(scryptHash("x", "y"), /^[0-9a-f]{64}$/);
});
