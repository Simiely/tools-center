// lib/routes/admin.js - 管理员域路由(密码设置/修改)
import { sendJson, jsonBody } from "./helpers.js";
import { loadAdminPass, saveAdminPass, changeAdminPass } from "../core/auth.js";

export const adminRoutes = [
  {
    p: "/api/admin/pass",
    handler: async (req, res) => {
      if (req.method === "GET") return sendJson(res, 200, { ok: true, set: !!loadAdminPass() });
      if (req.method === "POST") {
        try {
          const { pass } = await jsonBody(req);
          if (!pass || String(pass).length < 4) return sendJson(res, 400, { ok: false, error: "密码至少4位" });
          if (loadAdminPass()) return sendJson(res, 400, { ok: false, error: "已设置过密码" });
          saveAdminPass(String(pass));
          return sendJson(res, 200, { ok: true });
        } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    },
  },
  {
    m: "POST", p: "/api/admin/pass/change",
    handler: async (req, res) => {
      try {
        const { oldPass, newPass } = await jsonBody(req);
        const r = changeAdminPass(oldPass, newPass);
        return sendJson(res, r.ok ? 200 : 400, r);
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
];
