// lib/core/git.js - Git 仓库导入工具(浅克隆 + 工具识别 + 落位 tools/<id>)
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { DIRS } from "./config.js";

/** 从 Git 仓库导入工具:clone 到 tools/<id>/,自动识别 manifest.json/tool.json 与子目录工具。
 * @param {string} url 仓库地址(https/git/ssh 或本地路径)
 * @param {string} id 目标 id(可选,缺省从 URL 推导)
 * @param {object} opts { branch?, exists?: (id)=>boolean 目录冲突检查 }
 * @returns {Promise<{id, dir}>} 落位后的工具 id 与目录
 */
export async function importFromGit(url, id, opts = {}) {
  // 支持 https/git/ssh 远程协议;本地调试允许 Windows 盘符路径或相对路径(直接 clone)
  const isRemote = /^(https?|git|ssh):\/\//.test(url);
  const isLocalPath = /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith("/") || url.startsWith(".");
  if (!isRemote && !isLocalPath) throw new Error("需要 git 仓库地址(https/git/ssh) 或本地路径");
  const targetId = String(id || "").trim() || deriveIdFromUrl(url);
  if (!/^[a-z0-9-]+$/.test(targetId)) throw new Error("id 需为 [a-z0-9-]");
  if (opts.exists && opts.exists(targetId)) throw new Error("工具已存在: " + targetId);
  const dir = path.join(DIRS.tools, targetId);
  if (fs.existsSync(dir)) throw new Error("目录已存在(冲突): " + dir);

  const runGit = (args, cwd) => new Promise((resolve, reject) => {
    execFile("git", args, { cwd: cwd || dir, timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => err ? reject(new Error((stderr || stdout || err.message).trim().slice(0, 300))) : resolve(stdout));
  });

  // 浅克隆到临时目录,避免 clone 失败留下半成品
  const tmp = path.join(DIRS.tools, ".import-" + targetId + "-" + Date.now().toString(36));
  try {
    const cloneArgs = ["clone", "--depth", "1"];
    if (opts.branch) cloneArgs.push("--branch", opts.branch);
    cloneArgs.push(url, tmp);
    await runGit(cloneArgs, DIRS.tools);
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    throw e;
  }

  // 工具识别:仓库根有 manifest.json/tool.json → 整个仓库即工具;否则看一级子目录
  const findManifest = (d) => {
    if (fs.existsSync(path.join(d, "manifest.json"))) return path.join(d, "manifest.json");
    if (fs.existsSync(path.join(d, "tool.json"))) return path.join(d, "tool.json");
    return null;
  };
  let toolDir = tmp;
  let manifestFile = findManifest(tmp);
  if (!manifestFile) {
    const subs = fs.readdirSync(tmp).filter((n) => fs.statSync(path.join(tmp, n)).isDirectory());
    const withManifest = subs.find((n) => findManifest(path.join(tmp, n)));
    if (withManifest) { toolDir = path.join(tmp, withManifest); manifestFile = findManifest(toolDir); }
    else throw new Error("仓库中未找到 manifest.json/tool.json(根或一级子目录)");
  }

  // 工具 id 以 manifest 声明为准(覆盖 URL 推导),目录名与 id 一致
  let finalId = targetId;
  if (manifestFile) {
    try {
      const declared = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      if (declared && /^[a-z0-9-]+$/.test(String(declared.id || ""))) finalId = String(declared.id);
    } catch { /* 容错:声明非法时保留 URL 推导 id */ }
  }
  const finalDir = finalId === targetId ? dir : path.join(DIRS.tools, finalId);
  if (fs.existsSync(finalDir)) throw new Error("目录已存在(冲突): " + finalDir);
  fs.cpSync(toolDir, finalDir, { recursive: true, filter: (src) => !src.includes(path.sep + ".git" + path.sep) });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  return { id: finalId, dir: finalDir };
}

/** 从 URL 推导工具 id:github.com/user/repo → repo, 否则取最后路径段 */
export function deriveIdFromUrl(url) {
  const clean = url.replace(/\/+$/, "").replace(/\.git$/i, "");
  const seg = clean.split("/").filter(Boolean).pop() || "tool-" + Date.now().toString(36);
  return seg.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "tool-" + Date.now().toString(36);
}
