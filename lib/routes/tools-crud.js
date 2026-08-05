// lib/routes/tools-crud.js - 工具 CRUD 路由:列表/创建/删除/校验/Git 导入/重载/恢复托管
// 职责:工具注册表的增删查操作(不涉及进程控制,进程由 manager 在业务后同步)。
import { sendJson, jsonBody, publicTool, refreshTools } from "./helpers.js";
import { scanTools, listTools, getTool, createTool, removeTool, validateManifest } from "../core/registry.js";
import { restoreTool } from "../core/lifecycle.js";
import { importFromGit } from "../core/git.js";
import * as manager from "../core/manager.js";
import { checkPass } from "../core/auth.js";

export const toolsCrudRoutes = [
  {
    m: "GET", p: "/api/tools",
    handler: (req, res) => { refreshTools(); return sendJson(res, 200, { ok: true, tools: listTools().map(publicTool) }); },
  },
  {
    m: "POST", p: "/api/tools",
    handler: async (req, res) => {
      let spec;
      try { spec = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      try {
        const t = createTool(spec);
        manager.sync();
        return sendJson(res, 201, { ok: true, tool: publicTool(t) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "DELETE", p: "/api/tools",
    handler: async (req, res) => {
      let id = "", pass = "";
      try { const b = await jsonBody(req); id = String(b.id || ""); pass = String(b.pass || ""); } catch {}
      if (!id) return sendJson(res, 400, { ok: false, error: "缺少 id" });
      if (!checkPass(pass)) return sendJson(res, 403, { ok: false, error: "密码错误" });
      try {
        const t = getTool(id);
        if (t && t.type === "app") await manager.stop(t);  // 先停子进程(否则 Windows 下目录被占用)
        const r = removeTool(id);
        manager.sync();
        return sendJson(res, 200, { ok: true, removed: id, dirKept: r.dirKept, ghost: r.ghost || false });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/tools/validate",
    handler: async (req, res) => {
      let raw;
      try { raw = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      const r = validateManifest(raw.manifest || raw);
      return sendJson(res, r.ok ? 200 : 400, { ok: r.ok, errors: r.errors, normalized: r.normalized });
    },
  },
  {
    m: "POST", p: "/api/tools/import",
    handler: async (req, res) => {
      let b;
      try { b = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      if (!b.url) return sendJson(res, 400, { ok: false, error: "缺少 url" });
      try {
        // exists 回调:导入期间用当前注册表检查目标 id 是否已存在(防覆盖已托管工具)
        const { id } = await importFromGit(String(b.url), String(b.id || ""), {
          branch: b.branch ? String(b.branch) : undefined,
          exists: (tid) => !!getTool(tid),
        });
        manager.sync();
        const t = getTool(id);
        return sendJson(res, 201, { ok: true, tool: publicTool(t) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    m: "POST", p: "/api/reload",
    handler: (req, res) => { scanTools(); manager.sync(); return sendJson(res, 200, { ok: true, total: listTools().length }); },
  },
  // 恢复已解除托管的工具(清掉忽略标记,挂载型工具重新识别)
  {
    m: "POST", p: "/api/tools/restore",
    handler: async (req, res) => {
      try {
        const { id } = await jsonBody(req);
        if (!id) return sendJson(res, 400, { ok: false, error: "缺少 id" });
        restoreTool(String(id));
        scanTools();   // lifecycle.restoreTool 只清标记,扫描由调用方负责
        manager.sync();
        return sendJson(res, 200, { ok: true, restored: String(id) });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
];
