// lib/core/favicon.js - 网站图标抓取(v0.12.6:添加 link 快捷方式时自动抓取目标站 favicon)
// 零依赖:Node 原生 fetch + AbortController 超时。不阻塞创建——抓不到返回 null,前端静默降级。
// v0.13.0 安全:抓取前 DNS 校验目标 IP,拦截私网/环回/链路本地/保留地址(SSRF 防护,CWE-918)。
import { URL } from "node:url";
import dns from "node:dns";

const TIMEOUT_MS = 4000;
const MAX_BODY = 256 * 1024; // 只读 HTML 头 256KB(防大页面拖慢)
const dnsLookup = dns.promises.lookup;

/** 判断 IP 是否为私网/环回/链路本地/保留地址(SSRF 防护,2026-08-13)。
 *  IPv4 私有段(10/8, 172.16/12, 192.168/16)、环回(127/8)、链路本地(169.254/16)、
 *  云 metadata(169.254.169.254)、CGNAT(100.64/10)、0.0.0.0/8;
 *  IPv6 环回(::1)、链路本地(fe80::/10)、ULA(fc00::/7)。 */
export function isPrivateIp(ip) {
  const s = String(ip || "").trim().replace(/^\[|\]$/g, "");
  if (!s) return true;
  if (s.includes(":")) {
    const lower = s.toLowerCase();
    if (lower === "::1" || lower === "::" || lower === "::ffff:127.0.0.1") return true;
    // fe80::/10:fe8-feb 开头
    if (/^fe[89ab]/.test(lower)) return true;
    // fc00::/7:fc/fd 开头
    if (/^f[cd]/.test(lower)) return true;
    // IPv4 映射地址 ::ffff:a.b.c.d
    const m4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m4) return isPrivateIp(m4[1]);
    return false;
  }
  const parts = s.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true; // 非法 → 保守拦截
  const [a, b] = parts;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // 10.0.0.0/8
  if (a === 127) return true;                        // 127.0.0.0/8
  if (a === 169 && b === 254) return true;           // 169.254.0.0/16(含云 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
  if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/** 校验目标 URL 可抓取:协议限 http/https + DNS 解析 host 的 IP,命中私网/保留地址则拒绝。
 *  解析失败(域名不存在等)一律拒绝(宁可误杀,不探测内网)。
 *  @param {string} rawUrl 目标地址
 *  @returns {Promise<boolean>} true=允许抓取 */
export async function safeTargetUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || "")); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  // IP 字面量(含 [::1] 形式)直接判
  const literal = host.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) return !isPrivateIp(literal);
  // 域名 → DNS 解析后校验(防内网域名探测)
  try {
    const { address } = await dnsLookup(host, { verbatim: true });
    return !isPrivateIp(address);
  } catch { return false; }
}

/** 从 HTML 提取 favicon 绝对 URL(纯函数,可单测)。
 *  匹配顺序:rel="icon" / shortcut icon / apple-touch-icon;取第一个命中。
 *  相对路径(href="/favicon.ico"、"favicon.ico")按 baseUrl 拼成绝对 URL。
 *  @param {string} html 目标站首页 HTML
 *  @param {string} baseUrl 目标站 URL(如 https://example.com:8443)
 *  @returns {string|null} 绝对 favicon URL 或 null */
export function extractFaviconUrl(html, baseUrl) {
  if (!html) return null;
  const base = safeBase(baseUrl);
  if (!base) return null;
  // rel 含 icon(含 shortcut icon / apple-touch-icon),href 取第一个
  const re = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi;
  const m = html.match(re);
  for (const tag of m || []) {
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href && href[1]) {
      try {
        return new URL(href[1], base).href;
      } catch { /* 忽略坏 URL,继续 */ }
    }
  }
  // 无 icon 声明返回 null(纯解析,不猜 /favicon.ico;存在性由 fetchFavicon ② HEAD 校验决定)
  return null;
}

/** 解析目标 URL 的 origin 作为抓取基准;非法输入返回 null */
export function safeBase(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch { return null; }
}

/** 抓取目标站 favicon:① 首页 HTML 解析 <link rel="icon">;② 兜底 /favicon.ico(HEAD 校验存在)。
 *  SSRF 防护(2026-08-13):目标解析为私网/环回/保留地址时直接返回 null,不发起请求。
 *  @param {string} targetUrl link 型工具的跳转目标
 *  @returns {Promise<string|null>} 可用的 favicon 绝对 URL;失败/被拦截返回 null(不抛错) */
export async function fetchFavicon(targetUrl) {
  const base = safeBase(targetUrl);
  if (!base) return null;
  if (!(await safeTargetUrl(targetUrl))) return null; // SSRF 防护:私网目标不抓取
  // ① 首页 HTML → 解析 link rel=icon
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(base + "/", { signal: ctrl.signal, redirect: "follow" });
    if (r.ok) {
      const ct = r.headers.get("content-type") || "";
      const html = ct.includes("html") || !ct ? (await r.text()).slice(0, MAX_BODY) : "";
      clearTimeout(t);
      const icon = extractFaviconUrl(html, base);
      if (icon) return icon;
    } else clearTimeout(t);
  } catch { /* 超时/网络失败 → 走兜底 */ }

  // ② 兜底:根 /favicon.ico 存在性 HEAD
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const r = await fetch(base + "/favicon.ico", { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (r.ok && /^image\//.test(r.headers.get("content-type") || "")) return base + "/favicon.ico";
  } catch {}
  return null;
}
