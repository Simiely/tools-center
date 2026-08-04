// lib/core/auth.js - 管理员密码(sha256 摘要存储,不落明文)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DIRS } from "./config.js";

const ADMIN_PASS_FILE = path.join(DIRS.data, "admin-pass.json");

/** 读取密码摘要;未设置返回空串 */
export function loadAdminPass() {
  try { return JSON.parse(fs.readFileSync(ADMIN_PASS_FILE, "utf8")).hash || ""; }
  catch { return ""; }
}

/** 设置密码:存 sha256 摘要 */
export function saveAdminPass(pass) {
  fs.mkdirSync(DIRS.data, { recursive: true });
  fs.writeFileSync(ADMIN_PASS_FILE, JSON.stringify({ hash: hashPass(pass) }), "utf8");
}

/** 对输入密码做摘要(校验时比较) */
export function hashPass(pass) {
  return crypto.createHash("sha256").update(String(pass)).digest("hex");
}

/** 校验密码是否匹配;未设置密码时任何输入都通过 */
export function checkPass(pass) {
  const admin = loadAdminPass();
  return !admin || hashPass(pass) === admin;
}
