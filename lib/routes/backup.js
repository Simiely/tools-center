// lib/routes/backup.js - 备份域路由:数据级备份(/api/backup)+ 工具级备份(/api/tools/backup)
// v0.11.9:恢复/删除备份是破坏性写操作,需密码;创建/列表/下载为读操作免密。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "../core/config.js";
import { sendJson, jsonBody } from "./helpers.js";
import { checkPass } from "../core/auth.js";
import * as backup from "../core/backup.js";
import * as toolbackup from "../core/toolbackup.js";

export const backupRoutes = [
  // ---- API:数据级备份/恢复(工具存储数据 data/tools/*) ----
  {
    m: "POST", p: "/api/backup",
    handler: (req, res) => { try { return sendJson(res, 200, { ok: true, ...backup.localBackup() }); } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); } },
  },
  {
    m: "GET", p: "/api/backup",
    handler: (req, res) => sendJson(res, 200, { ok: true, backups: backup.listBackups() }),
  },
  {
    m: "POST", p: "/api/restore",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.backup) return sendJson(res, 400, { ok: false, error: "缺少 backup(备份目录名)" });
        if (!checkPass(String(b.pass ?? ""))) return sendJson(res, 403, { ok: false, error: "密码错误" }); // 恢复覆盖数据,需密码
        return sendJson(res, 200, { ok: true, ...backup.localRestore(b.backup) });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  // ---- API:工具级备份/恢复(代码+数据全包 zip) ----
  {
    m: "POST", p: "/api/tools/backup",
    handler: (req, res) => {
      try { return sendJson(res, 200, { ok: true, ...toolbackup.backupTools() }); }
      catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "GET", p: "/api/tools/backup",
    handler: (req, res) => {
      try { return sendJson(res, 200, { ok: true, backups: toolbackup.listToolBackups() }); }
      catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "DELETE", p: "/api/tools/backup",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.file) return sendJson(res, 400, { ok: false, error: "缺少 file(备份文件名)" });
        if (!checkPass(String(b.pass ?? ""))) return sendJson(res, 403, { ok: false, error: "密码错误" }); // 删除备份,需密码
        const r = toolbackup.deleteToolBackup(String(b.file));
        return sendJson(res, 200, { ok: true, ...r });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/tools/backup/restore",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.backup) return sendJson(res, 400, { ok: false, error: "缺少 backup(备份文件名)" });
        if (!checkPass(String(b.pass ?? ""))) return sendJson(res, 403, { ok: false, error: "密码错误" }); // 恢复覆盖工具,需密码
        const r = toolbackup.restoreFromZip(String(b.backup), b.tools);
        return sendJson(res, 200, { ok: true, ...r });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "GET", p: "/api/tools/backup/download",
    handler: (req, res, url) => {
      try {
        const name = String(url.searchParams.get("file") || "");
        if (!name || !name.startsWith("tools-") || !name.endsWith(".zip")) return sendJson(res, 400, { ok: false, error: "非法备份文件名" });
        const f = path.join(DIRS.data, "backups", path.basename(name));
        if (!fs.existsSync(f)) return sendJson(res, 404, { ok: false, error: "备份不存在" });
        const buf = fs.readFileSync(f);
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` });
        return res.end(buf);
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
];
