// lib/core/capability.js - 能力装配器
// 读取工具 manifest.capabilities → 检查能力注册表 → 生成该工具的能力环境(env)。
// 懒加载:工具启动时只注入能力入口 env,不立即拉起能力进程;SDK 首次调用时由 ensure() 触发。
import path from "node:path";
import { CONFIG, DIRS } from "./config.js";
import { hasCapability, listCapabilities, getCapability } from "../capabilities/index.js";

/**
 * 为工具生成能力注入(env 附加项)。
 * @param {object} m 归一化 manifest
 * @returns {object} 追加到工具进程 env 的键值
 * 约定: CAP_<NAME>_PORT / CAP_<NAME>_DIR / CAP_<NAME>_BASE(能力内部 API 地址)
 */
export function capabilityEnv(m) {
  const env = {};
  const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
  // 平台 ensure 端点:工具懒加载触发能力启动(同机直连平台 API)
  if (caps.length) env.CAP_ENSURE_EP = `http://127.0.0.1:${CONFIG.PORT}/api/capabilities/`;
  for (const name of caps) {
    const key = name.toUpperCase();
    // 目录:工具专属数据目录(存储能力,见 M2)
    if (name === "storage") {
      env.CAP_STORAGE_DIR = path.join(DIRS.data, "tools", m.id);
    }
    if (name === "browser") {
      // 懒加载:注入能力基址(由装配器在运行时提供,未启动时为空;SDK 通过 ensure 获取实际地址)
      env.CAP_BROWSER_BASE = ""; // 占位:SDK 调 /api/capabilities/browser/ensure 后获取
    }
    // 未知能力:记录但不注入(平台容错)
  }
  return env;
}

/** 能力是否已注册且可用(工具声明了但平台没有 → 提示) */
export function checkCapabilities(m) {
  const missing = (m.capabilities || []).filter((c) => !hasCapability(c));
  return missing;
}

/** 能力状态视图(门户展示 idle/running) */
export function capabilitiesStatus() {
  return listCapabilities();
}

/** 懒加载触发:确保能力模块运行,返回能力入口信息 */
export async function ensureCapability(name) {
  if (!hasCapability(name)) throw new Error("能力未注册: " + name);
  const mod = getCapability(name);
  if (mod.ensure) await mod.ensure();
  // 能力基址:模块自报(如 browser 的 HTTP 端口)
  const base = mod.base ? mod.base() : "";
  return { name, status: mod.status(), base };
}
