// lib/routes/tools-files.js - 工具文件域路由:日志读取 + 文件/zip 上传
// 职责:① GET /api/logs/<id> 读工具运行日志;② POST /api/files 上传代码/zip(自动解压与重启)。
// ② 支持两种模式:
//   a) 传统:multipart 带 path(如 tools/<id>/) → 解压到指定目录,已存在工具则重启
//   b) 零输入(2026-08-06):multipart 不带 path 的纯 zip → 从 zip 内 tool.json 自动创建/更新工具,无需任何表单输入
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import { sendJson, jsonBody, publicTool } from "./helpers.js";
import { scanTools, getTool, validateManifest } from "../core/registry.js";
import { restoreTool } from "../core/lifecycle.js"; // zip 导入 = 重新托管:清除 removed 标记
import * as manager from "../core/manager.js";
import { readLog } from "../core/logger.js";
import { DIRS } from "../core/config.js";
import { unzipAsync, resolveWithinRoot, parseMultipart, findManifest, checkZipBuffer } from "../core/upload.js";
import { passOk } from "../core/auth.js"; // 高危写面密码门(2026-08-06 审计加固)
import { classifyDirFiles } from "../core/data-classify.js"; // 数据识别公共层(升级保留数据,v0.11.8 起不依赖 disk-ops)
import { importFromGit } from "../core/git.js"; // Git 仓库导入(import 模块,2026-08-06 迁入)

/** 纯 zip 零输入:解压 → 从 zip 内 tool.json 读取配置 → 创建/更新 tools/<id>/ → 自动启动
 * 返回 {code, body},由路由层 sendJson(供 /api/files 上传 与 /api/tools/import URL 导入共用)
 * @param {Buffer} data zip 内容
 * @param {string} filename zip 文件名(用于兜底 id)
 */
/** 语义化版本比较(2026-08-06,覆盖升级提醒用):a>b 返回正数,a<b 负数,相等 0。支持 v1.4.41 / 1.4.41 形式。 */
function compareVersion(a, b) {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export async function zipToTool(data, filename = "tool.zip", opts = {}) {
  checkZipBuffer(data); // 下载/上传内容校验:非 zip 或截断时给出明确原因,而非笼统"解压失败"(2026-08-06)
  const tmp = path.join(DIRS.data, ".tmp-import-" + Date.now().toString(36));
  fs.mkdirSync(tmp, { recursive: true });
  const zipPath = path.join(tmp, "upload.zip");
  try {
    fs.writeFileSync(zipPath, data || Buffer.alloc(0));
    await unzipAsync(zipPath, tmp);
    // 定位声明文件(tool.json / manifest.json,支持顶层或单层子目录)
    const { manifestPath, toolRoot } = findManifest(tmp);
    if (!manifestPath) return { code: 400, body: { ok: false, error: "zip 内未找到 tool.json / manifest.json,无法自动创建" } };
    let spec;
    try { spec = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch { return { code: 400, body: { ok: false, error: "tool.json 解析失败" } }; }
    const check = validateManifest(spec);
    if (!check.ok) return { code: 400, body: { ok: false, error: "tool.json 无效: " + check.errors.join("; ") } };
    // id:manifest.id,缺失则用 zip 文件名(去 .zip)
    const zipBase = (filename || "tool").replace(/\.zip$/i, "");
    const id = String(spec.id || zipBase || "tool").toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!/^[a-z0-9-]+$/.test(id)) return { code: 400, body: { ok: false, error: "工具 id 无效: " + id } };
    const target = path.join(DIRS.tools, id);
    const existed = fs.existsSync(target) && fs.existsSync(path.join(target, "tool.json"));
    // 旧版本号(覆盖升级对比用;tool.json 可选字段,缺失则 unknown)
    let oldVersion = "";
    if (existed) {
      try { const oj = JSON.parse(fs.readFileSync(path.join(target, "tool.json"), "utf8")); oldVersion = String(oj.version || "").trim(); } catch {}
    }
    fs.mkdirSync(DIRS.tools, { recursive: true });
    // 覆盖升级(2026-08-06):旧目录的数据文件先暂存(dataFiles 声明 + 通用规则),程序替换后再放回 —— 升级不清数据
    let stash = null;
    if (existed) {
      try {
        let oldDataFiles = [];
        try { const oj = JSON.parse(fs.readFileSync(path.join(target, "tool.json"), "utf8")); oldDataFiles = Array.isArray(oj.dataFiles) ? oj.dataFiles : []; } catch {}
        const cls = classifyDirFiles(target, oldDataFiles);
        if (cls.data.length) {
          stash = path.join(DIRS.data, ".stash-" + Date.now().toString(36));
          fs.mkdirSync(stash, { recursive: true });
          for (const f of cls.data) {
            const src = path.join(target, ...f.rel.split("/"));
            const dst = path.join(stash, f.rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            try { fs.copyFileSync(src, dst); } catch {}
          }
        }
      } catch { /* 暂存失败不阻塞升级(数据随旧目录被替换) */ }
    }
    // 版本对比(覆盖导入提醒/降级确认):up=升级 / down=降级 / same=同版本 / unknown=任一方无 version
    let upgrade;
    if (existed) {
      const newVersion = String(spec.version || "").trim();
      if (oldVersion && newVersion) {
        const c = compareVersion(newVersion, oldVersion);
        upgrade = { from: oldVersion, to: newVersion, direction: c > 0 ? "up" : c < 0 ? "down" : "same" };
      } else upgrade = { from: oldVersion, to: String(spec.version || "").trim(), direction: "unknown" };
    }
    // 降级保护(2026-08-06):旧版覆盖新版需显式确认(opts.confirm),否则 409 拒绝,不执行任何写入
    if (existed && upgrade.direction === "down" && !opts.confirm) {
      return { code: 409, body: { ok: false, error: "检测到版本回退,需确认后继续", needConfirm: true, upgrade } };
    }
    if (existed) { try { fs.rmSync(target, { recursive: true, force: true }); } catch {} }
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(toolRoot, target, { recursive: true }); // 内容复制(含 tool.json)
    // 恢复暂存的数据文件
    if (stash) {
      try {
        const walk = (cur, rel) => {
          for (const n of fs.readdirSync(cur)) {
            const full = path.join(cur, n);
            const relPath = rel ? rel + "/" + n : n;
            const st = fs.statSync(full);
            if (st.isDirectory()) { walk(full, relPath); continue; }
            const dst = path.join(target, relPath);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            try { fs.copyFileSync(full, dst); } catch {}
          }
        };
        walk(stash, "");
      } catch {}
      try { fs.rmSync(stash, { recursive: true, force: true }); } catch {}
    }
    // zip 导入 = 重新托管:先清除 removed 标记(被"解除托管"的工具目录仍在,若不清除
    // scanTools 会跳过它 → getTool 返回 null → 报"工具配置无效: 未知",同一工具永远无法重新导入)
    restoreTool(id);
    scanTools(); // 刷新注册表(新工具出现或 tool.json 更新)
    const t = getTool(id);
    if (!t || !t.valid) return { code: 400, body: { ok: false, error: "工具配置无效: " + (t ? t.error : "未知") } };
    if (t.type === "app") { try { await manager.restart(t); } catch {} }
    manager.sync();
    return { code: 201, body: { ok: true, created: !existed, tool: publicTool(t), ...(upgrade ? { upgrade } : {}) } };
  } catch (e) {
    return { code: 400, body: { ok: false, error: e.message } };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

/**
 * 下载 URL(支持 HTTPS_PROXY/HTTP_PROXY 环境变量走代理;跟随重定向)。
 * 手写实现:node 22 的 undici 不能直接 import,全局 fetch 不读环境代理 → 用 CONNECT 隧道。
 * @param {number} timeoutMs 超时(毫秒)
 * @param {number} depth 重定向深度(内部用)
 * @param {(receivedBytes:number)=>void} [onProgress] 收到数据回调(字节累计,进度 UI 用)
 */
function downloadUrl(url, timeoutMs = 60000, depth = 0, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("重定向过深"));
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const u = new URL(url);
    const httpsMod = u.protocol === "https:";
    const doRequest = (host, port, createConnection) => {
      const req = (httpsMod ? https : http).request(
        { host, port, path: u.pathname + u.search, method: "GET", headers: { "User-Agent": "tools-center" }, ...(createConnection ? { createConnection } : {}) },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return resolve(downloadUrl(new URL(res.headers.location, url).toString(), timeoutMs, depth + 1, onProgress));
          }
          const chunks = [];
          let received = 0;
          res.on("data", (c) => { chunks.push(c); received += c.length; if (onProgress) try { onProgress(received); } catch {} });
          res.on("end", () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error("HTTP " + res.statusCode))));
        }
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    };
    if (proxy) {
      const p = new URL(proxy);
      const port = u.port || (httpsMod ? 443 : 80);
      const conn = http.request({
        host: p.hostname, port: p.port || (p.protocol === "https:" ? 443 : 80),
        method: "CONNECT", path: `${u.host}:${port}`, headers: { Host: u.host },
      });
      conn.on("connect", (res, socket) => {
        if (res.statusCode !== 200) { socket.destroy(); return reject(new Error("代理 CONNECT 失败 HTTP " + res.statusCode)); }
        if (httpsMod) {
          // 隧道 socket 上先做 TLS(servername=目标 host),再在 TLS socket 上发 HTTP
          const tlsSocket = tls.connect({ socket, servername: u.host, rejectUnauthorized: false }, () => {
            doRequest(u.host, port, () => tlsSocket);
          });
          tlsSocket.on("error", reject);
        } else {
          doRequest(u.host, port, () => socket);
        }
      });
      conn.on("error", reject);
      conn.end();
    } else {
      doRequest(u.host, u.port || (httpsMod ? 443 : 80));
    }
  });
}

/**
 * 解包 multipart 包裹的响应(个别代理/中间层会把下载内容包成 form-data,2026-08-06 实测遇到)。
 * 检测到 Content-Disposition: form-data + filename 时,提取 file 段内容;否则原样返回。
 */
function unwrapMultipart(buf) {
  const head = buf.subarray(0, Math.min(300, buf.length)).toString("utf8");
  if (head.includes("Content-Disposition: form-data") && head.includes("filename=")) {
    const sep = buf.indexOf(Buffer.from("\r\n\r\n"));
    const end = buf.indexOf(Buffer.from("\r\n------"));
    if (sep > 0) return end > sep ? buf.subarray(sep + 4, end) : buf.subarray(sep + 4);
  }
  return buf;
}

/** 从 URL 下载 zip 并自动创建/更新工具(供 /api/tools/import 填链接导入,2026-08-06) */
export async function importZipFromUrl(url, res) {
  try {
    const buf = unwrapMultipart(await downloadUrl(url));
    const name = (url.split("?")[0].split("/").pop() || "tool.zip");
    const out = await zipToTool(buf, name);
    return sendJson(res, out.code, out.body);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: "下载失败: " + e.message });
  }
}

// ---- 导入异步任务(2026-08-06):下载/解压/启动可能耗时数十秒,前端轮询进度,避免干等 ----
const importTasks = new Map();
let importTaskSeq = 0;

/**
 * 创建 zip 链接导入异步任务,立即返回 taskId;后台执行 下载→解压创建→启动。
 * @param {string} url zip 下载链接
 * @returns {{id:string}} 任务句柄(可再 getImportTask 查询)
 */
export function createZipImportTask(url, opts = {}) {
  const id = "imp-" + Date.now().toString(36) + "-" + (importTaskSeq++);
  const task = { id, status: "queued", message: "排队中", progress: 0, downloaded: 0, createdAt: Date.now() };
  importTasks.set(id, task);
  const name = (url.split("?")[0].split("/").pop() || "tool.zip");
  (async () => {
    try {
      task.status = "downloading";
      task.message = "正在下载 " + name + "…";
      task.progress = 5;
      const buf = unwrapMultipart(await downloadUrl(url, 180000, 0, (n) => {
        task.downloaded = n;
        task.progress = Math.min(40, 5 + Math.log10(Math.max(1, n)) * 6); // 1B→5%,10KB→29%,1MB→41%,封顶 40%
      }));
      task.status = "extracting";
      task.message = "解压并创建工具…";
      task.progress = 55;
      const out = await zipToTool(buf, name, { confirm: !!opts.confirm });
      if (!out.body || !out.body.ok) {
        if (out.body && out.body.needConfirm) { task.result = out.body; throw new Error(out.body.error); }
        throw new Error(out.body?.error || "导入失败");
      }
      task.status = "starting";
      task.message = "启动工具…";
      task.progress = 85;
      // 等 1 拍让进程起来,再上报完成(进程就绪与否由工具自身健康检查体现)
      await new Promise((r) => setTimeout(r, 600));
      task.status = "done";
      task.message = "完成";
      task.progress = 100;
      task.result = { ok: true, created: out.body.created === true, tool: out.body.tool };
    } catch (e) {
      task.status = "error";
      task.message = e.message || "导入失败";
    } finally {
      task.finishedAt = Date.now();
    }
  })();
  return { id };
}

/** 查询导入任务状态(状态机:queued/downloading/extracting/starting/done/error) */
export function getImportTask(id) {
  const t = importTasks.get(id);
  if (!t) return null;
  return { id: t.id, status: t.status, message: t.message, progress: t.progress, downloaded: t.downloaded, createdAt: t.createdAt, finishedAt: t.finishedAt, result: t.result || undefined };
}

/** 清理超过 1 小时的已完成/失败任务(防内存膨胀) */
export function pruneImportTasks() {
  const cutoff = Date.now() - 3600000;
  for (const [k, t] of importTasks) if (t.finishedAt && t.finishedAt < cutoff) importTasks.delete(k);
}

// ---- Git 仓库导入异步任务(与 zip 任务同模式;2026-08-06 从 tools-crud 迁入,统一 import 模块) ----
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

export const toolsFilesRoutes = [
  // 在线导入(2026-08-06,v0.11.7 起归 import 模块;Git 仓库 / zip 链接,异步任务 + 进度轮询)
  {
    m: "POST", p: "/api/tools/import",
    handler: async (req, res) => {
      let b;
      try { b = await jsonBody(req); } catch { return sendJson(res, 400, { ok: false, error: "JSON 解析失败" }); }
      // 密码门(2026-08-06):设置密码后导入必须携带有效密码——导入即拉起进程,是最高危写面之一
      if (!passOk(b, req.headers)) return sendJson(res, 403, { ok: false, error: "需要管理员密码", needAuth: true });
      if (!b.url) return sendJson(res, 400, { ok: false, error: "缺少 url" });
      try {
        if (/\.zip($|\?)/i.test(String(b.url))) {
          const { id: taskId } = createZipImportTask(String(b.url), { confirm: !!b.confirm });
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
