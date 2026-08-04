// lib/sdk.js - 工具 SDK(供工具代码引用,可选封装)
// 能力调用约定:工具不直接感知能力实现,经 SDK 访问。
// 懒加载:首次调用能力时 SDK 先请求平台 ensure(触发能力模块启动),再直连能力 API。
// 注意:本文件会被复制/挂载到工具目录使用(platform base 由环境变量或平台注入提供)。

const PLATFORM = process.env.CAP_PLATFORM_BASE || ""; // 平台反代基址(工具被托管时由平台注入 /tool 前缀外的 API 基址)

async function ensure(name) {
  const base = PLATFORM || "";
  // 平台 ensure 端点:经反代或直连(平台与工具同机时用 127.0.0.1:平台端口)
  // 工具由平台托管时,平台把 ensure 端点注入为 CAP_PLATFORM_ENSURE(见装配器)
  const ep = process.env.CAP_ENSURE_EP;
  if (!ep) return { base: "" };
  const r = await fetch(`${ep}${name}/ensure`, { method: "POST" });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "能力启动失败: " + name);
  return j; // { base, status }
}

/**
 * 浏览器桥能力:返回操作句柄(tabs/cmd/eval/newtab/status)。
 * 首次调用触发懒加载;能力不可用(无浏览器)时方法抛错,工具可捕获降级。
 */
export async function capBrowser() {
  const info = await ensure("browser");
  const BASE = info.base || process.env.CAP_BROWSER_BASE;
  if (!BASE) throw new Error("浏览器桥不可用(未装配或未启动)");
  const req = async (path, opts) => {
    const r = await fetch(BASE + path, opts);
    return r.json();
  };
  return {
    status: () => req("/status"),
    tabs: () => req("/tabs"),
    eval: (expr, target = 0) => req(`/eval?target=${encodeURIComponent(target)}&expr=${encodeURIComponent(expr)}`),
    cmd: (method, params = {}, targetId) => req("/cmd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params, targetId }) }),
    newtab: (url) => req(`/newtab?url=${encodeURIComponent(url)}`),
  };
}

/**
 * 存储能力:返回工具专属数据目录(平台注入 CAP_STORAGE_DIR)。
 */
export function capStorageDir() {
  return process.env.CAP_STORAGE_DIR || null;
}
