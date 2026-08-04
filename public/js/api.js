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
async function apiImport(url, branch, id) {
  const j = await (await fetch("/api/tools/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, branch: branch || undefined, id: id || undefined }) })).json();
  if (!j.ok) throw new Error(j.error);
  return j;
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

/** 管理员密码:查询是否已设置 / 首次设置 / 修改 */
const apiPass = {
  status: () => getJSON("/api/admin/pass"),
  set: (pass) => postJSON("/api/admin/pass", { pass }),
  change: (oldPass, newPass) => postJSON("/api/admin/pass/change", { oldPass, newPass }),
};
