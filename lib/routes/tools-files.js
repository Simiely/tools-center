// lib/routes/tools-files.js - 工具文件域路由:日志读取 + 文件/zip 上传
// 职责:① GET /api/logs/<id> 读工具运行日志;② POST /api/files 上传代码/zip(自动解压与重启)。
// ② 支持两种模式:
//   a) 传统:multipart 带 path(如 tools/<id>/) → 解压到指定目录,已存在工具则重启
//   b) 零输入(2026-08-06):multipart 不带 path 的纯 zip → 从 zip 内 tool.json 自动创建/更新工具,无需任何表单输入
import fs from "node:fs";
import path from "node:path";
import { sendJson, jsonBody, publicTool } from "./helpers.js";
import { scanTools, getTool, validateManifest } from "../core/registry.js";
import * as manager from "../core/manager.js";
import { readLog } from "../core/logger.js";
import { DIRS } from "../core/config.js";
import { unzipAsync, resolveWithinRoot, parseMultipart, findManifest } from "../core/upload.js";

/** 纯 zip 零输入:解压 → 从 zip 内 tool.json 读取配置 → 创建/更新 tools/<id>/ → 自动启动 */
async function handleZipImport(file, res) {
  const tmp = path.join(DIRS.data, ".tmp-import-" + Date.now().toString(36));
  fs.mkdirSync(tmp, { recursive: true });
  const zipPath = path.join(tmp, "upload.zip");
  try {
    fs.writeFileSync(zipPath, file.data || Buffer.alloc(0));
    await unzipAsync(zipPath, tmp);
    // 定位声明文件(tool.json / manifest.json,支持顶层或单层子目录)
    const { manifestPath, toolRoot } = findManifest(tmp);
    if (!manifestPath) {
      return sendJson(res, 400, { ok: false, error: "zip 内未找到 tool.json / manifest.json,无法自动创建" });
    }
    let spec;
    try { spec = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch { return sendJson(res, 400, { ok: false, error: "tool.json 解析失败" }); }
    const check = validateManifest(spec);
    if (!check.ok) return sendJson(res, 400, { ok: false, error: "tool.json 无效: " + check.errors.join("; ") });
    // id:manifest.id,缺失则用 zip 文件名(去 .zip)
    const zipBase = (file.filename || "tool").replace(/\.zip$/i, "");
    const id = String(spec.id || zipBase || "tool").toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!/^[a-z0-9-]+$/.test(id)) return sendJson(res, 400, { ok: false, error: "工具 id 无效: " + id });
    const target = path.join(DIRS.tools, id);
    const existed = fs.existsSync(target) && fs.existsSync(path.join(target, "tool.json"));
    fs.mkdirSync(DIRS.tools, { recursive: true });
    if (existed) { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} }
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(toolRoot, target, { recursive: true }); // 内容复制(含 tool.json)
    scanTools(); // 刷新注册表(新工具出现或 tool.json 更新)
    const t = getTool(id);
    if (!t || !t.valid) return sendJson(res, 400, { ok: false, error: "工具配置无效: " + (t ? t.error : "未知") });
    if (t.type === "app") { try { await manager.restart(t); } catch {} }
    manager.sync();
    return sendJson(res, 201, { ok: true, created: !existed, tool: publicTool(t) });
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: e.message });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

export const toolsFilesRoutes = [
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
  {
    m: "POST", p: "/api/files",
    handler: async (req, res) => {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        try {
          const { fields, files } = await parseMultipart(req, contentType);
          const f = files[0];
          if (!f) return sendJson(res, 400, { ok: false, error: "缺少 file" });
          const target = fields.path;
          // 零输入模式:未指定 path → 纯 zip 上传,从 zip 内 tool.json 自动创建/更新(2026-08-06)
          if (!target) {
            if (!f.filename || !f.filename.toLowerCase().endsWith(".zip")) {
              return sendJson(res, 400, { ok: false, error: "未指定 path:需上传 .zip 包(zip 内含 tool.json 自动创建工具)" });
            }
            return handleZipImport(f, res);
          }
          // path 以 / 结尾视为目录:自动拼接上传文件名(如 tools/wb-credits/ + code.zip)
          const realPath = target.endsWith("/") || target.endsWith("\\") ? target + (f.filename || "file.bin") : target;
          const dest = resolveWithinRoot(realPath);
          if (!dest) return sendJson(res, 400, { ok: false, error: "路径越界" });
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, f.data || Buffer.alloc(0));
          // zip 自动解压到目标目录,解压后删除压缩包
          const isZip = realPath.toLowerCase().endsWith(".zip");
          if (isZip) {
            try { await unzipAsync(dest, path.dirname(dest)); }
            catch (e) { try { fs.unlinkSync(dest); } catch {} return sendJson(res, 400, { ok: false, error: e.message }); }
            try { fs.unlinkSync(dest); } catch { /* 删除失败不阻塞(沙箱/只读卷下 zip 残留无害) */ }
          }
          // zip 解压后:若目标是 tools/<id>/ 下的工具,自动重启让新代码/新 tool.json 生效
          const tid = isZip ? (realPath.match(/^tools\/([^/]+)\//) || [])[1] : "";
          if (tid) {
            scanTools(); // 必须先刷新 registry:解压已覆盖 tool.json,内存 Map 仍是旧配置
            const t = getTool(tid);
            if (t && t.type === "app") { try { await manager.restart(t); } catch {} }
          }
          return sendJson(res, 200, { ok: true, path: realPath, unzipped: isZip, restarted: !!tid });
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
      }
      // JSON 模式(兼容旧)
      try {
        const j = await jsonBody(req);
        if (!j.path) return sendJson(res, 400, { ok: false, error: "缺少 path" });
        const dest = resolveWithinRoot(j.path);
        if (!dest) return sendJson(res, 400, { ok: false, error: "路径越界" });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, j.content ?? "", j.encoding === "base64" ? "base64" : "utf8");
        return sendJson(res, 200, { ok: true, path: j.path });
      } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
    },
  },
];
