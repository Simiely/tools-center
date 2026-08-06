// lib/routes/webdav.js - WebDAV 域路由(云同步配置 + 备份上传/下载)
// v0.11.9:保存配置需密码(写敏感凭据)。
import path from "node:path";
import { sendJson, jsonBody } from "./helpers.js";
import { loadSyncConfig, saveSyncConfig, testConnection } from "../core/webdav.js";
import { checkPass } from "../core/auth.js";
import * as backup from "../core/backup.js";

export const webdavRoutes = [
  {
    m: "GET", p: "/api/webdav",
    handler: (req, res) => { const cfg = loadSyncConfig(); return sendJson(res, 200, { ok: true, configured: !!cfg, url: cfg ? cfg.url : "" }); },
  },
  {
    m: "POST", p: "/api/webdav",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        if (!b.url || !b.user || !b.pass) return sendJson(res, 400, { ok: false, error: "需要 url/user/pass" });
        if (!checkPass(String(b.adminPass ?? ""))) return sendJson(res, 403, { ok: false, error: "密码错误" }); // 保存敏感凭据需密码
        saveSyncConfig({ url: String(b.url), user: String(b.user), pass: String(b.pass) });
        return sendJson(res, 200, { ok: true });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/test",
    handler: async (req, res) => {
      try {
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        await testConnection(cfg.url, cfg.user, cfg.pass);
        return sendJson(res, 200, { ok: true });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/upload",
    handler: async (req, res) => {
      try {
        let b = {};
        try { b = await jsonBody(req); } catch {}
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        const bl = backup.listBackups();
        const ts = b.backup && bl.includes(b.backup) ? b.backup : (bl.length ? bl[bl.length - 1] : null);
        if (!ts) { const nb = backup.localBackup(); return sendJson(res, 200, { ok: true, ...(await backup.webdavUpload(cfg, nb.dir)) }); }
        return sendJson(res, 200, { ok: true, ...(await backup.webdavUpload(cfg, path.join(backup.BACKUPS_ROOT, ts))) });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/webdav/download",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        const cfg = loadSyncConfig();
        if (!cfg) return sendJson(res, 400, { ok: false, error: "未配置 WebDAV" });
        if (!b.ts) return sendJson(res, 400, { ok: false, error: "缺少 ts(云端备份时间戳)" });
        const dl = await backup.webdavDownload(cfg, String(b.ts));
        return sendJson(res, 200, { ok: true, ...dl });
      } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    },
  },
];
