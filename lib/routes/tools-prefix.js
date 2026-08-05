// lib/routes/tools-prefix.js - 单工具操作路由:/api/tools/<id> 的查询/重启/暂停/恢复
// 职责:单个工具的运行时控制(restart/pause/resume)与状态查询。
// 注意:通配前缀必须排在 backup 的 /api/tools/backup* 精确路由之后(index.js 保证)。
import { sendJson, publicTool } from "./helpers.js";
import { scanTools, getTool } from "../core/registry.js";
import { setPaused } from "../core/lifecycle.js";
import * as manager from "../core/manager.js";

export const toolsPrefixRoutes = [
  {
    prefix: "/api/tools/",
    handler: async (req, res, url) => {
      const parts = url.pathname.split("/"); // ["","api","tools",id,maybe action]
      const id = decodeURIComponent(parts[3] || "");
      const t = getTool(id);
      if (!t) return sendJson(res, 404, { ok: false, error: "tool not found" });
      if (parts[4] === "restart" && req.method === "POST") {
        if (t.type !== "app") return sendJson(res, 400, { ok: false, error: "link 型不支持重启" });
        await manager.restart(t);
        return sendJson(res, 200, { ok: true });
      }
      // 暂停:停止进程且不再自动拉起(start 跳过 paused);恢复:清标记并重新启动
      if ((parts[4] === "pause" || parts[4] === "resume") && req.method === "POST") {
        if (t.type !== "app") return sendJson(res, 400, { ok: false, error: "link 型不支持暂停" });
        const paused = parts[4] === "pause";
        setPaused(t.id, paused);
        scanTools();
        manager.sync(); // 暂停 → 停止运行;恢复 → 启动
        return sendJson(res, 200, { ok: true, paused, id: t.id });
      }
      return sendJson(res, 200, { ok: true, tool: publicTool(t) });
    },
  },
];
