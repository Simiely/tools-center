// public/js/api.js - API 封装层:所有 fetch 调用集中于此
// 统一错误处理:返回 { ok:false, error } 时抛 Error;成功返回 data
const $ = (id) => document.getElementById(id);

function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }

/** GET JSON;失败返回 null */
async function getJSON(url) {
  try { return await (await fetch(url, { cache: "no-store" })).json(); } catch { return null; }
}

/** POST JSON;失败返回 { ok:false, error } */
async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

/** 删除工具(需密码) */
async function apiDeleteTool(id, pass) {
  const j = await (await fetch("/api/tools", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, pass }) })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
}

/** 重启工具 */
async function apiRestart(id) {
  const j = await (await fetch("/api/tools/" + id + "/restart", { method: "POST" })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
}

/** 暂停/恢复工具(暂停 = 停止进程且不自动拉起) */
async function apiPause(id, paused) {
  const j = await (await fetch("/api/tools/" + id + (paused ? "/pause" : "/resume"), { method: "POST" })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
}

/** 存储管理:磁盘残留清单 / 清理 / 恢复托管 */
const apiDisk = {
  list: () => getJSON("/api/admin/disk"),
  clean: async (dirs, pass) => {
    const j = await (await fetch("/api/admin/disk/clean", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dirs, pass }) })).json();
    if (!j.ok) throw new Error(j.error);
    return j;
  },
  restore: async (id) => {
    const j = await (await fetch("/api/admin/disk/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })).json();
    if (!j.ok) throw new Error(j.error);
    return j;
  },
  cleanData: async (dir, pass) => {
    const j = await (await fetch("/api/admin/disk/clean-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir, pass }) })).json();
    if (!j.ok) throw new Error(j.error);
    return j;
  },
};

/** 读取工具日志 */
async function apiLogs(id) {
  return getJSON("/api/logs/" + id);
}

/** 校验 manifest */
async function apiValidate(manifest) {
  return (await fetch("/api/tools/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifest }) })).json();
}

/** 创建工具(app/link) */
async function apiCreate(spec) {
  const j = await (await fetch("/api/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
}

/** Git 导入工具 */
/** 导入工具(Git 仓库或 .zip 链接)。v0.11.4 起后端异步任务化:立即返回 taskId,轮询进度,完成返回 {ok,created,tool} */
let onImportProgress = null; // 进度回调(status/message/progress),由 UI 层设置
async function apiImport(url, branch, id) {
  const j = await postJSON("/api/tools/import", { url, branch: branch || undefined, id: id || undefined });
  if (!j.ok) throw new Error(j.error);
  if (!j.taskId) return j; // 兼容同步返回
  if (onImportProgress) onImportProgress({ status: "queued", message: "任务已创建", progress: 0 });
  const deadline = Date.now() + 6 * 60 * 1000; // 总超时 6 分钟
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    let s;
    try {
      s = await (await fetch("/api/tools/import/status/" + j.taskId, { cache: "no-store" })).json();
    } catch { continue; }
    if (onImportProgress) onImportProgress(s);
    if (s.status === "done") return s.result ? { ok: true, ...s.result } : { ok: true };
    if (s.status === "error") throw new Error(s.message || "导入失败");
    if (Date.now() > deadline) throw new Error("导入超时(超过 6 分钟),请检查网络/代理后重试");
  }
}

/** 上传 zip 到工具目录并重启 */
async function apiUploadZip(id, zip) {
  const fd = new FormData();
  fd.append("path", "tools/" + id + "/");
  fd.append("file", zip, zip.name);
  const j = await (await fetch("/api/files", { method: "POST", body: fd })).json();
  if (!j.ok) throw new Error(j.error);
  await fetch("/api/tools/" + id + "/restart", { method: "POST" });
}

/** 零输入上传(2026-08-06):纯 zip 不带 path,后端从 zip 内 tool.json 自动创建/更新工具 */
async function apiUploadZipAuto(zip) {
  const fd = new FormData();
  fd.append("file", zip, zip.name);
  const j = await (await fetch("/api/files", { method: "POST", body: fd })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
}

/** 管理员密码:查询是否已设置 / 首次设置 / 修改 */
const apiPass = {
  status: () => getJSON("/api/admin/pass"),
  set: (pass) => postJSON("/api/admin/pass", { pass }),
  change: (oldPass, newPass) => postJSON("/api/admin/pass/change", { oldPass, newPass }),
};

/** 工具级备份:执行备份 / 列表 / 恢复所选工具 / 下载 zip */
const apiToolBackup = {
  create: async () => {
    const j = await (await fetch("/api/tools/backup", { method: "POST" })).json();
    if (!j.ok) throw new Error(j.error);
    return j;
  },
  list: () => getJSON("/api/tools/backup"),
  restore: async (backup, tools) => {
    const j = await postJSON("/api/tools/backup/restore", { backup, tools });
    if (!j.ok) throw new Error(j.error);
    return j;
  },
  downloadUrl: (file) => "/api/tools/backup/download?file=" + encodeURIComponent(file),
  del: async (file) => {
    const j = await fetch("/api/tools/backup", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file }) }).then(r => r.json());
    if (!j.ok) throw new Error(j.error);
    return j;
  },
};
