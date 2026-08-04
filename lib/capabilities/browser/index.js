// lib/capabilities/browser/index.js - 浏览器桥能力模块
// 实现 createCapabilityBase 的接口(start/stop)。懒加载:工具首次调用时才启动
// (ensure → 平台内起 CDP 代理 HTTP 服务),空闲回收时 stop。
import { CONFIG } from "../../core/config.js";
import { createCapabilityBase } from "../index.js";
import { createBrowserServer, stopBrowserServer } from "./daemon.mjs";

// 固定端口:能力端口段起始(8200);多能力可顺延
let serverRef = null;
let portRef = 0;

function allocatePort() {
  for (let p = CONFIG.CAP_PORT_MIN; p <= CONFIG.CAP_PORT_MAX; p++) {
    if (!portRef) { portRef = p; return p; }
  }
  return CONFIG.CAP_PORT_MIN;
}

const base = createCapabilityBase("browser", {
  async start() {
    if (serverRef) return; // 已启动
    const port = allocatePort();
    serverRef = await createBrowserServer(port);
    portRef = port;
  },
  stop() {
    stopBrowserServer(serverRef);
    serverRef = null;
    portRef = 0;
  },
});

/** 浏览器桥能力入口(装配器注入:base 或固定端口) */
export const browserCap = base;
export function browserBase() { return portRef ? `http://127.0.0.1:${portRef}` : ""; }
// 供装配器 ensureCapability 读取能力基址
base.base = browserBase;
