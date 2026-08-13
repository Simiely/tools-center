// lib/routes/tools-logs.js - 工具日志域路由(主干,不随 import 模块关闭)
// v0.13.0 从 tools-files.js 拆出:日志读取是主干功能(工具详情弹窗依赖),不应挂在 import 模块开关下。
// 关闭 import(上传/在线导入)模块后本路由仍可用。
import { sendJson } from "./helpers.js";
import { getTool } from "../core/registry.js";
import { readLog } from "../core/logger.js";

export const logsRoutes = [
  {
    prefix: "/api/logs/",
    handler: (req, res, url) => {
      const id = decodeURIComponent(url.pathname.split("/")[3] || "");
      const t = getTool(id);
      if (!t) return sendJson(res, 404, { ok: false, error: "not found" });
      if (t.type !== "app") return sendJson(res, 400, { ok: false, error: "link 型无日志" });
      const lines = Math.min(parseInt(url.searchParams.get("lines") || "200", 10) || 200, 1000);
      return sendJson(res, 200, { ok: true, id, lines: readLog(id, lines) });
    },
  },
];
