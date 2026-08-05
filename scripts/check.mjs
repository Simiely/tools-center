// scripts/check.mjs - 全模块语法检查(跨平台:Windows cmd 不展开 glob,用 node 遍历)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 收集要检查的 .js/.mjs 文件(递归 lib/ 下全部,public/js/,入口) */
function collect(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...collect(p));
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [
  path.join(ROOT, "server.mjs"),
  ...collect(path.join(ROOT, "lib")),
  ...collect(path.join(ROOT, "public", "js")),
];

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    failed++;
    console.error(`✕ ${path.relative(ROOT, f)}\n${r.stderr || r.stdout}`);
  }
}
console.log(failed ? `✕ ${failed}/${files.length} 文件语法错误` : `✓ 语法检查通过(${files.length} 文件)`);
process.exit(failed ? 1 : 0);
