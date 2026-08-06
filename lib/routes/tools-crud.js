// lib/routes/tools-crud.js - 工具 CRUD 路由:列表/创建/删除/校验/Git 导入/重载/恢复托管
// 职责:工具注册表的增删查操作(不涉及进程控制,进程由 manager 在业务后同步)。
import { sendJson, jsonBody, publicTool, refreshTools } from "./helpers.js";
import { scanTools, listTools, getTool, createTool, removeTool, validateManifest } from "../core/registry.js";
import { restoreTool } from "../core/lifecycle.js";
import { importFromGit } from "../core/git.js";
import { importZipFromUrl, createZipImportTask, getImportTask, pruneImportTasks } from "./tools-files.js";
import * as manager from "../core/manager.js";
import { checkPass } from "../core/auth.js";

// ---- Git 导入异步任务(与 zip 任务同模式:clone 也可能耗时,前端轮询进度) ----
const gitImportTasks = new Map();
let gitTaskSeq = 0;
function createGitImportTask(url, id, branch) {
  const taskId = "git-" + Date.now().toString(36) + "-" + (gitTaskSeq++);
  const task = { id: taskId, status: "cloning", message: "克隆仓库…", progress: 10, createdAt: Date.now() };
  gitImportTasks.set(taskId, task);
  (async () => {
    try {
      const { id: finalId } = await importFromGit(url, String(id || ""), {
        branch: branch || undefined,
        exists: (tid) => !!getTool(tid),
      });
      task.status = "starting";
      task.message = "启动工具…";
      task.progress = 70;
      manager.sync();
      const t = getTool(finalId);
      if (!t) throw new Error("工具未注册: " + finalId);
      task.status = "done";
      task.message = "完成";
      task.progress = 100;
      task.result = { ok: true, created: true, tool: publicTool(t) };
    } catch (e) {
      task.status = "error";
      task.message = e.message || "导入失败";
    } finally {
      task.finishedAt = Date.now();
    }
  })();
  return { id: taskId };
}
function getGitImportTask(id) {
  const t = gitImportTasks.get(id);
  if (!t) return null;
  return { id: t.id, status: t.status, message: t.message, progress: t.progress, createdAt: t.createdAt, finishedAt: t.finishedAt, result: t.result || undefined };
}

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
        // 链接导入(2026-08-06):URL 以 .zip 结尾 → 下载 zip 自动创建/更新工具(复用 zipToTool)
        // 异步任务化(2026-08-06):下载/解压/启动可能耗时数十秒 → 立即返回 taskId,前端轮询 /api/tools/import/status/<id> 显示进度
        if (/\.zip($|\?)/i.test(String(b.url))) {
          const { id: taskId } = createZipImportTask(String(b.url));
          return sendJson(res, 202, { ok: true, taskId });
        }
        const { id: taskId } = createGitImportTask(String(b.url), String(b.id || ""), String(b.branch || ""));
        return sendJson(res, 202, { ok: true, taskId });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
  {
    prefix: "/api/tools/import/status/",
    handler: (req, res, url) => {
      const tid = decodeURIComponent(url.pathname.split("/").pop() || "");
      pruneImportTasks();
      const t = getImportTask(tid) || getGitImportTask(tid);
      if (!t) return sendJson(res, 404, { ok: false, error: "任务不存在或已过期" });
      return sendJson(res, 200, t);
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
