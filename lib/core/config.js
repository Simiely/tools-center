// lib/config.js - 全局常量与路径(集中在此,便于调整)
import path from "node:path";
import { fileURLToPath } from "node:url";

// 项目根 = 本文件(lib/core/)上两级
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DIRS = {
  root: ROOT,
  tools: path.join(ROOT, "tools"),     // 工具目录(挂载卷,声明式接入)
  data: path.join(ROOT, "data"),       // 运行时数据(挂载卷)
  logs: path.join(ROOT, "data", "logs"),
  public: path.join(ROOT, "public"),   // 静态资源(首页)
};

export const CONFIG = {
  PORT: parseInt(process.env.PORT || "8080", 10), // 主程序端口
  TOOL_PORT_MIN: 8100,  // 工具端口段
  TOOL_PORT_MAX: 8199,
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
