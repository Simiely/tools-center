// lib/routes/tools-files.js - 工具文件域路由:文件/zip 上传(/api/files)
// v0.13.0 拆分:zip/Git 在线导入与任务轮询 → tools-import.js;日志读取 → tools-logs.js(主干)。
// 本组挂 module:"import"(可关)。支持两种模式:
//   a) 传统:multipart 带 path(如 tools/<id>/) → 解压到指定目录,已存在工具则重启
//   b) 零输入(2026-08-06):multipart 不带 path 的纯 zip → 从 zip 内 tool.json 自动创建/更新工具,无需任何表单输入
import fs from "node:fs";
import path from "node:path";
import { sendJson, jsonBody } from "./helpers.js";
import { scanTools, getTool } from "../core/registry.js";
import * as manager from "../core/manager.js";
import { unzipAsync, resolveWithinRoot, parseMultipart } from "../core/upload.js";
import { passOk } from "../core/auth.js"; // 高危写面密码门(2026-08-06 审计加固)
import { zipToTool } from "./tools-import.js"; // 纯 zip 零输入创建/覆盖工具(共用业务)

export const toolsFilesRoutes = [
  {
    m: "POST", p: "/api/files",
    handler: async (req, res) => {
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("multipart/form-data")) {
        try {
          const { fields, files } = await parseMultipart(req, contentType);
          // 密码门(2026-08-06):设置密码后上传/写入必须携带有效密码(fields.pass 或 X-Admin-Pass)
          if (!passOk(fields, req.headers)) return sendJson(res, 403, { ok: false, error: "需要管理员密码", needAuth: true });
          const f = files[0];
          if (!f) return sendJson(res, 400, { ok: false, error: "缺少 file" });
          const target = fields.path;
          // 零输入模式:未指定 path → 纯 zip 上传,从 zip 内 tool.json 自动创建/更新(2026-08-06)
          if (!target) {
            if (!f.filename || !f.filename.toLowerCase().endsWith(".zip")) {
              return sendJson(res, 400, { ok: false, error: "未指定 path:需上传 .zip 包(zip 内含 tool.json 自动创建工具)" });
            }
            const out = await zipToTool(f.data, f.filename, { confirm: fields.confirm === "1" || fields.confirm === "true" });
            return sendJson(res, out.code, out.body);
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
        // 密码门(2026-08-06):设置密码后写入需携带有效密码
        if (!passOk(j, req.headers)) return sendJson(res, 403, { ok: false, error: "需要管理员密码", needAuth: true });
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
