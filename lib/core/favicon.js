// lib/core/favicon.js - 网站图标抓取(v0.12.6:添加 link 快捷方式时自动抓取目标站 favicon)
// 零依赖:Node 原生 fetch + AbortController 超时。不阻塞创建——抓不到返回 null,前端静默降级。
import { URL } from "node:url";

const TIMEOUT_MS = 4000;
const MAX_BODY = 256 * 1024; // 只读 HTML 头 256KB(防大页面拖慢)

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
 *  @param {string} targetUrl link 型工具的跳转目标
 *  @returns {Promise<string|null>} 可用的 favicon 绝对 URL;失败返回 null(不抛错) */
export async function fetchFavicon(targetUrl) {
  const base = safeBase(targetUrl);
  if (!base) return null;
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
