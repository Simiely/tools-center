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

/** 设置密码:存 sha256 摘要;空密码 = 清除(删除密码文件,回到无密码状态) */
export function saveAdminPass(pass) {
  const p = String(pass ?? "");
  if (!p.trim()) {
    try { fs.unlinkSync(ADMIN_PASS_FILE); } catch {}
    return;
  }
  fs.mkdirSync(DIRS.data, { recursive: true });
  fs.writeFileSync(ADMIN_PASS_FILE, JSON.stringify({ hash: hashPass(p) }), "utf8");
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

/** 已设置密码时,请求必须携带有效密码(body.pass 或 X-Admin-Pass 头),否则返回 false。
 * 未设置密码 = 开放(内网单用户默认)。用于 import / /api/files 等此前未鉴权的高危写面(2026-08-06 审计加固)。 */
export function passOk(body, headers) {
  if (!loadAdminPass()) return true;
  const p = (body && body.pass) || (headers && headers["x-admin-pass"]) || "";
  return checkPass(p);
}

/**
 * 设置/修改密码:校验旧密码(仅当已有密码时) → 写入新密码摘要。
 * 新密码为空 = 清除密码(无密码状态)。
 * @returns {{ok: boolean, error?: string}} 失败返回错误原因
 */
export function changeAdminPass(oldPass, newPass) {
  const admin = loadAdminPass();
  if (admin && hashPass(String(oldPass)) !== admin) return { ok: false, error: "旧密码错误" };
  saveAdminPass(String(newPass ?? ""));
  return { ok: true };
}
