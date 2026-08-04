// lib/capabilities/browser/index.js - 浏览器桥能力模块
// 实现 createCapabilityBase 的接口(start/stop)。懒加载:工具首次调用时才启动
// (ensure → 平台内起 CDP 代理 HTTP 服务),空闲回收时 stop。
import { CONFIG } from "../../core/config.js";
import { createCapabilityBase } from "../index.js";
import { createBrowserServer, stopBrowserServer } from "./daemon.mjs";

// 固定端口:能力端口段起始(8200);browser 是平台内唯一浏览器桥,单实例占用一个端口
let serverRef = null;
let portRef = 0;

function allocatePort() {
  // 懒加载单例:首次启动分配端口段内第一个可用端口,此后复用
  if (!portRef) portRef = CONFIG.CAP_PORT_MIN;
  return portRef;
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
