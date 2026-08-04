// lib/config.js - 全局常量与路径(集中在此,便于调整)
import path from "node:path";
import { fileURLToPath } from "node:url";

// 项目根 = 本文件(lib/core/)上两级
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// 目录可被环境变量覆盖(TOOLS_DIR/DATA_DIR),部署时可显式写死扫描范围;
// 未设置时回退到 <项目根>/tools 与 <项目根>/data(与历史行为一致)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");

export const DIRS = {
  root: ROOT,
  tools: process.env.TOOLS_DIR ? path.resolve(process.env.TOOLS_DIR) : path.join(ROOT, "tools"),
  data: DATA_DIR,
  logs: path.join(DATA_DIR, "logs"),
  public: path.join(ROOT, "public"),   // 静态资源(首页)
};

export const CONFIG = {
  PORT: parseInt(process.argv[2] || process.env.PORT || "8080", 10), // 主程序端口(支持命令行参数)
  TOOL_PORT_MIN: 8100,  // 工具端口段
  TOOL_PORT_MAX: 8199,
  CAP_PORT_MIN: 8200,   // 能力模块端口段(懒加载启动时占用)
  CAP_PORT_MAX: 8299,
  // 已注册能力白名单(单一来源:manifest 校验与 capabilities 注册表共用)
  KNOWN_CAPABILITIES: ["browser", "storage", "network"],
  HEALTH_INTERVAL_MS: 30000, // 健康检查轮询间隔
  PROXY_TIMEOUT_MS: 60000,   // 反向代理超时
  LOG_KEEP_DAYS: 7,          // 日志保留天数
  LOG_MEM_LINES: 200,        // 内存日志行数(快速查看)
  RESTART_BACKOFF_BASE_MS: 1000,  // 崩溃拉起退避:1s,2s,4s...
  RESTART_BACKOFF_MAX_MS: 30000,  // ...封顶 30s
  RESTART_MAX_FAILS: 5,           // 连续失败 5 次标记 error,停止拉起
  SIGTERM_GRACE_MS: 5000,         // 优雅停止:SIGTERM 后 5s 强制 SIGKILL
  HEALTH_TIMEOUT_MS: 3000,        // 单次健康探测超时
};
