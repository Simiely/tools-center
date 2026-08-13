// lib/core/auth.js - 管理员密码(摘要存储,不落明文)
// v0.13.0 升级:无盐 sha256 → scrypt + 随机盐(OWASP Password Storage Cheat Sheet 要求慢哈希+盐)。
// 兼容迁移:旧格式 {hash: sha256hex}(v0.12.7 及更早)校验通过后自动升级为新格式,无需手动处理。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DIRS } from "./config.js";

const ADMIN_PASS_FILE = path.join(DIRS.data, "admin-pass.json");

// scrypt 参数(OWASP 最小建议 N=2^17;个人内网工具取 2^15 平衡 ~64ms 阻塞,登录/写操作低频无感)
const SCRYPT_N = 1 << 15, SCRYPT_R = 8, SCRYPT_P = 1, SCRYPT_KEYLEN = 32;
const SALT_BYTES = 16; // 128 位随机盐

/** scrypt 摘要(确定性:同 pass+同 salt 同输出,供校验;导出供单测)
 *  maxmem:OpenSSL 默认 32MB,128*N*r = 32MiB 恰好超限,显式放宽 */
export function scryptHash(pass, salt) {
  return crypto.scryptSync(String(pass), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  }).toString("hex");
}

/**
 * 读取管理员密码记录。返回:
 *  - 新格式 {v:2, salt, hash} / 旧格式 {hash: sha256hex}(v0.12.7 及更早)
 *  - 未设置返回 null
 */
export function loadAdminPass() {
  try {
    const raw = JSON.parse(fs.readFileSync(ADMIN_PASS_FILE, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.hash) return null;
    return raw;
  } catch { return null; }
}

/** 设置密码:写 scrypt(v2) 格式;空密码 = 清除(删除密码文件,回到无密码状态) */
export function saveAdminPass(pass) {
  const p = String(pass ?? "");
  if (!p.trim()) {
    try { fs.unlinkSync(ADMIN_PASS_FILE); } catch {}
    return;
  }
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  fs.mkdirSync(DIRS.data, { recursive: true });
  fs.writeFileSync(ADMIN_PASS_FILE, JSON.stringify({ v: 2, salt, hash: scryptHash(p, salt) }), "utf8");
}

/**
 * 旧格式摘要(sha256 无盐)——仅用于兼容 v0.12.7 及更早存储的密码记录校验。
 * 新格式一律走 scryptHash。不应用于新写入。
 */
export function hashPass(pass) {
  return crypto.createHash("sha256").update(String(pass)).digest("hex");
}

/** 校验密码是否匹配;未设置密码时任何输入都通过。
 *  旧格式(sha256)校验通过后自动升级为新格式(scrypt)——下次写入即完成迁移。 */
export function checkPass(pass) {
  const rec = loadAdminPass();
  if (!rec) return true; // 未设置密码
  if (rec.v === 2 && rec.salt) return scryptHash(pass, rec.salt) === rec.hash;
  // 旧格式兼容:sha256 无盐;通过则自动升级(2026-08-13)
  if (hashPass(pass) === rec.hash) {
    try { saveAdminPass(pass); } catch {}
    return true;
  }
  return false;
}

/** 已设置密码时,请求必须携带有效密码(body.pass 或 X-Admin-Pass 头),否则返回 false。
 * 未设置密码 = 开放(内网单用户默认)。用于 import / /api/files / 创建工具等写面。 */
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
  if (loadAdminPass() && !checkPass(String(oldPass))) return { ok: false, error: "旧密码错误" };
  saveAdminPass(String(newPass ?? ""));
  return { ok: true };
}
