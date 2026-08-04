// tests/git.test.mjs - Git URL 推导测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveIdFromUrl } from "../lib/core/git.js";

test("deriveIdFromUrl:github 仓库取 repo 名", () => {
  assert.equal(deriveIdFromUrl("https://github.com/user/my-tool.git"), "my-tool");
});

test("deriveIdFromUrl:无 .git 后缀", () => {
  assert.equal(deriveIdFromUrl("https://github.com/user/my-tool"), "my-tool");
});

test("deriveIdFromUrl:末尾斜杠容错", () => {
  assert.equal(deriveIdFromUrl("https://github.com/user/my-tool/"), "my-tool");
});

test("deriveIdFromUrl:非法字符转 '-'", () => {
  assert.equal(deriveIdFromUrl("https://example.com/My Tool_2"), "my-tool-2");
});
