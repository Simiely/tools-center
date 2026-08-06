// lib/routes/disk.js - 存储管理域路由:磁盘残留清单/清理/恢复托管/单独清理数据
// v0.11.6+:清理与删除前自动备份(toolbackup → data/backups/tools-<ts>.zip,可还原),杜绝误删。
import { sendJson, jsonBody } from "./helpers.js";
import { checkPass } from "../core/auth.js";
import { scanDisk, cleanWithStop, cleanDataFiles } from "../core/disk-ops.js";
import { restoreTool, setPaused } from "../core/lifecycle.js";
import { scanTools, getTool } from "../core/registry.js";
import * as manager from "../core/manager.js";
import * as toolbackup from "../core/toolbackup.js";

/** 清理/删除前自动备份(失败不阻塞主流程),返回备份信息供前端提示 */
function autoBackup() {
  try { return toolbackup.backupTools(); } catch { return null; }
}

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
        const backup = autoBackup(); // 清理前备份(可还原)
        const results = await cleanWithStop(dirs); // 托管中工具先停进程再删
        return sendJson(res, 200, { ok: true, results, backup: backup ? { file: backup.file, size: backup.size, tools: backup.tools.length } : undefined });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  {
    m: "POST", p: "/api/admin/disk/clean-data",
    handler: async (req, res) => {
      try {
        const { dir, pass } = await jsonBody(req);
        if (!dir) return sendJson(res, 400, { ok: false, error: "缺少 dir" });
        if (!checkPass(String(pass || ""))) return sendJson(res, 403, { ok: false, error: "密码错误" });
        // 托管中的 app 先停进程(否则 Windows 下数据文件被占用删不掉),删完恢复运行
        const t = getTool(String(dir));
        const wasRunning = t && t.type === "app" && manager.statusOf(t).status === "running";
        if (t && t.type === "app") await manager.stop(t);
        const backup = autoBackup(); // 清数据前备份(可还原)
        const r = cleanDataFiles(String(dir));
        if (wasRunning && t) { try { await manager.restart(t); } catch {} } // 重启让工具重建空数据
        manager.sync();
        return sendJson(res, 200, { ok: true, ...r, backup: backup ? { file: backup.file, size: backup.size } : undefined });
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
