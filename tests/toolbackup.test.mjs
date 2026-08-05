// tests/toolbackup.test.mjs - 工具级备份/恢复测试(备份→删除→恢复全流程)
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 用临时目录隔离 DIRS,不污染真实 data
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tc-tb-"));
const tmpData = path.join(tmpRoot, "data");
const tmpTools = path.join(tmpRoot, "tools");
process.env.DATA_DIR = tmpData;
process.env.TOOLS_DIR = tmpTools;

const { zipPackDir } = await import("../lib/core/zip.js");
const tb = await import("../lib/core/toolbackup.js");

function makeTool(id, content) {
  const dir = path.join(tmpTools, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify({ id, name: id }), "utf8");
  fs.writeFileSync(path.join(dir, "code.js"), content, "utf8");
  fs.writeFileSync(path.join(dir, "data.json"), '{"accounts":["a"]}', "utf8"); // 模拟运行数据
  return dir;
}

test("backupTools:备份所有工具目录到 zip,列表可读", async () => {
  makeTool("tool-a", "console.log('a')");
  makeTool("tool-b", "console.log('b')");
  fs.mkdirSync(path.join(tmpTools, "tool-b", "sub"), { recursive: true });
  fs.writeFileSync(path.join(tmpTools, "tool-b", "sub", "x.js"), "x", "utf8");

  const r = tb.backupTools();
  assert.ok(r.file.startsWith("tools-"), "文件名前缀 tools-");
  assert.ok(r.file.endsWith(".zip"));
  assert.ok(r.size > 0);
  assert.deepStrictEqual([...r.tools].sort(), ["tool-a", "tool-b"]);

  const list = tb.listToolBackups();
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual([...list[0].tools].sort(), ["tool-a", "tool-b"]);
});

test("restoreFromZip:备份→删除→恢复,代码与数据完整", async () => {
  // 前提:tool-a 已在(上个测试创建),先删掉它模拟"删错"
  fs.rmSync(path.join(tmpTools, "tool-a"), { recursive: true, force: true });
  assert.ok(!fs.existsSync(path.join(tmpTools, "tool-a")), "删除成功");

  const list = tb.listToolBackups();
  const r = tb.restoreFromZip(list[0].file, ["tool-a"]);
  assert.deepStrictEqual(r.restored, ["tool-a"]);
  assert.deepStrictEqual(r.skipped, []);

  // 验证代码+数据完整
  assert.strictEqual(fs.readFileSync(path.join(tmpTools, "tool-a", "code.js"), "utf8"), "console.log('a')");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(tmpTools, "tool-a", "data.json"), "utf8")), { accounts: ["a"] });
  assert.ok(fs.existsSync(path.join(tmpTools, "tool-a", "tool.json")));
});

test("restoreFromZip:恢复不存在的工具 → skipped", () => {
  const list = tb.listToolBackups();
  const r = tb.restoreFromZip(list[0].file, ["tool-a", "ghost-tool"]);
  assert.deepStrictEqual(r.restored, ["tool-a"]);
  assert.deepStrictEqual(r.skipped, ["ghost-tool"]);
});

test("restoreFromZip:目标已存在时自动备份现有目录(.pre-restore-)", () => {
  // 前置:第 3 个测试恢复 tool-a 时已产生 1 个 pre-restore;先清空再验证本次
  for (const n of fs.readdirSync(tmpTools)) if (n.startsWith("tool-a.pre-restore-")) fs.rmSync(path.join(tmpTools, n), { recursive: true, force: true });

  // 修改 tool-a 再恢复,应产生新的 .pre-restore 目录
  fs.writeFileSync(path.join(tmpTools, "tool-a", "code.js"), "MODIFIED", "utf8");
  const list = tb.listToolBackups();
  tb.restoreFromZip(list[0].file, ["tool-a"]);

  const pre = fs.readdirSync(tmpTools).filter((n) => n.startsWith("tool-a.pre-restore-"));
  assert.strictEqual(pre.length, 1, "应有 1 个 pre-restore 备份");
  assert.strictEqual(fs.readFileSync(path.join(tmpTools, pre[0], "code.js"), "utf8"), "MODIFIED", "pre-restore 应保留被覆盖前内容");
  assert.strictEqual(fs.readFileSync(path.join(tmpTools, "tool-a", "code.js"), "utf8"), "console.log('a')", "恢复后回到备份内容");
});

test("restoreFromZip:非法备份名/未指定工具报错", () => {
  assert.throws(() => tb.restoreFromZip("not-exist.zip", ["tool-a"]), /备份不存在/);
  const list = tb.listToolBackups();
  assert.throws(() => tb.restoreFromZip(list[0].file, []), /未指定/);
});

test("deleteToolBackup:删除指定备份 zip(幂等)", () => {
  const list = tb.listToolBackups();
  assert.ok(list.length > 0, "应有备份");
  const file = list[0].file;
  const r1 = tb.deleteToolBackup(file);
  assert.strictEqual(r1.deleted, true, "第一次应删除成功");
  const r2 = tb.deleteToolBackup(file);
  assert.strictEqual(r2.deleted, false, "已删过的应幂等返回 deleted:false");
  // 列表里不再有它
  assert.ok(!tb.listToolBackups().some((b) => b.file === file), "备份应从列表消失");
});

test("deleteToolBackup:非法文件名(路径穿越/非 tools- 前缀)拒绝", () => {
  assert.throws(() => tb.deleteToolBackup("../evil.zip"), /非法备份文件名/);
  assert.throws(() => tb.deleteToolBackup("foo.zip"), /非法备份文件名/);
  assert.throws(() => tb.deleteToolBackup(""), /非法备份文件名/);
});
