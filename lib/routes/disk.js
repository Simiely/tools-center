// lib/routes/disk.js - 存储管理域路由:磁盘残留清单/清理/恢复托管
import { sendJson, jsonBody } from "./helpers.js";
import { checkPass } from "../core/auth.js";
import { scanDisk, cleanWithStop } from "../core/disk-ops.js";
import { restoreTool, setPaused } from "../core/lifecycle.js";
import { scanTools } from "../core/registry.js";
import * as manager from "../core/manager.js";

export const diskRoutes = [
  {
    m: "GET", p: "/api/admin/disk",
    handler: (req, res) => sendJson(res, 200, { ok: true, items: scanDisk() }),
  },
  {
    m: "POST", p: "/api/admin/disk/clean",
    handler: async (req, res) => {
      try {
        const { dirs, pass } = await jsonBody(req);
        if (!Array.isArray(dirs) || !dirs.length) return sendJson(res, 400, { ok: false, error: "缺少 dirs(要清理的目录列表)" });
        if (!checkPass(String(pass || ""))) return sendJson(res, 403, { ok: false, error: "密码错误" });
        const results = await cleanWithStop(dirs); // 托管中工具先停进程再删
        return sendJson(res, 200, { ok: true, results });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  {
    m: "POST", p: "/api/admin/disk/restore",
    handler: async (req, res) => {
      try {
        const { id } = await jsonBody(req);
        if (!id) return sendJson(res, 400, { ok: false, error: "缺少 id" });
        restoreTool(String(id));
        setPaused(String(id), false);
        scanTools();   // lifecycle.restoreTool 只清标记,扫描由调用方负责
        manager.sync();
        return sendJson(res, 200, { ok: true, restored: String(id) });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
];
