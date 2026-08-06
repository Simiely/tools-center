// lib/routes/admin.js - 管理员域路由:密码(auth 模块,可关)+ 功能开关(主干,不可关——关 auth 后仍需能开回)
import { sendJson, jsonBody } from "./helpers.js";
import { loadAdminPass, saveAdminPass, changeAdminPass, checkPass } from "../core/auth.js";
import { getModules, setModules, MODULE_INFO } from "../core/settings.js";

/** 密码路由(auth 模块开关控制) */
export const adminRoutes = [
  {
    p: "/api/admin/pass",
    handler: async (req, res) => {
      if (req.method === "GET") return sendJson(res, 200, { ok: true, set: !!loadAdminPass() });
      if (req.method === "POST") {
        try {
          const { pass } = await jsonBody(req);
          // 空密码 = 清除(无密码状态);非空则覆盖设置
          saveAdminPass(String(pass ?? ""));
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

/** 功能开关路由(主干,不随 auth 关闭;保存时校验密码,无密码时免密) */
export const settingsRoutes = [
  {
    p: "/api/admin/settings",
    handler: async (req, res) => {
      if (req.method === "GET") {
        return sendJson(res, 200, { ok: true, modules: getModules(), info: MODULE_INFO });
      }
      if (req.method === "PUT" || req.method === "POST") {
        try {
          const { modules, pass } = await jsonBody(req);
          if (!checkPass(String(pass ?? ""))) return sendJson(res, 403, { ok: false, error: "密码错误" });
          const next = setModules(modules && typeof modules === "object" ? modules : {});
          return sendJson(res, 200, { ok: true, modules: next, note: "已保存,重启后生效" });
        } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      }
      return sendJson(res, 404, { ok: false, error: "not found" });
    },
  },
];
