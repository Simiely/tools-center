// public/js/app.js - 主逻辑:加载/添加工具/密码/事件绑定/初始化
// 依赖: api.js($, toast, api*), ui.js(renderTabs/renderCards/loadCaps/loadLog/openDetail 等)

/* ---------- 加载工具列表 ---------- */
async function load() {
  try {
    const j = await (await fetch("/api/tools", { cache: "no-store" })).json();
    if (!j.ok) throw new Error(j.error);
    tools = (j.tools || []).filter(t => !t.hidden);
    renderTabs();
    renderCards();
    const running = tools.filter(t => t.status && t.status.status === "running").length;
    $("stat").textContent = running + "/" + tools.length + " 运行";
    $("meta").textContent = " · " + tools.length + " 工具";
    loadCaps();  // 并行加载能力状态(更新顶栏指示器)
  } catch (e) { $("main").innerHTML = `<div class="empty"><div class="empty-icon">!</div><p>${e.message}</p></div>`; }
}

// 卡片点击/删除事件委托
document.addEventListener("click", e => {
  const del = e.target.closest(".del-btn");
  if (del) { e.stopPropagation(); delTool(del.dataset.id, del.dataset.name); return; }
  const card = e.target.closest(".card");
  if (!card) return;
  const t = (window.__tools || []).find(x => x.id === card.dataset.id);
  if (t) openDetail(t);
});

/* ---------- 添加工具 ---------- */
let addType = "app", advOpen = !1;
function openAdd() { $("addMask").classList.add("show"); updatePreview(); }
function closeAdd() { $("addMask").classList.remove("show"); }
function toggleAdv() { advOpen = !advOpen; $("fAdv").style.display = advOpen ? "" : "none"; $("advBtn").textContent = (advOpen ? "▾" : "▸") + " 高级设置"; updatePreview(); }
function setType(t) {
  addType = t;
  $("ftApp").classList.toggle("on", t === "app");
  $("ftLink").classList.toggle("on", t === "link");
  $("ftGit").classList.toggle("on", t === "git");
  $("fAppRows").style.display = t === "app" ? "" : "none";
  $("fLinkRows").style.display = t === "link" ? "" : "none";
  $("fGitRows").style.display = t === "git" ? "" : "none";
  $("fAdvApp").style.display = t === "app" ? "" : "none";
  updatePreview();
}
function collectSpec() {
  if (addType === "git") return { git: true, name: ($("fName").value || "").trim(), url: ($("fGitUrl").value || "").trim(), branch: ($("fGitBranch").value || "").trim(), id: $("fId").value.trim() };
  const s = { name: ($("fName").value || "").trim(), type: addType };
  if (addType === "link") s.url = ($("fUrl").value || "").trim();
  const a = { id: $("fId").value.trim(), desc: $("fDesc").value.trim(), group: $("fGroup").value.trim(), icon: $("fIcon").value.trim(), cmd: $("fCmd").value.trim(), port: $("fPort").value.trim(), health: $("fHealth").value.trim() };
  if (a.id) s.id = a.id;
  if (a.desc) s.desc = a.desc;
  if (a.group && a.group !== "工具") s.group = a.group;
  if (a.icon && a.icon !== "🔧") s.icon = a.icon;
  if (addType === "app") { if (a.cmd) { try { const c = JSON.parse(a.cmd); if (Array.isArray(c)) s.cmd = c; } catch {} } if (a.port) s.port = parseInt(a.port, 10); if (a.health) s.health = a.health; }
  return s;
}
function updatePreview() { const s = collectSpec(); $("fPreview").textContent = s.git ? `Git 导入: ${s.url || "(未填)"}` : JSON.stringify(s, null, 2); }
["fName", "fUrl", "fId", "fDesc", "fGroup", "fIcon", "fCmd", "fPort", "fHealth", "fGitUrl", "fGitBranch"].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener("input", updatePreview); });

let selZip = null;
function pickZip() { $("fZipInput").value = ""; $("fZipInput").click(); }
function handleDrop(files) { if (files.length) { selZip = files[0]; $("fZipInfo").textContent = selZip.name + " (" + Math.round(selZip.size / 1024) + " KB)"; } }
$("fZipInput").addEventListener("change", () => { const f = $("fZipInput").files[0]; if (f) { selZip = f; $("fZipInfo").textContent = f.name + " (" + Math.round(f.size / 1024) + " KB)"; } });

async function saveAdd() {
  const spec = collectSpec();
  if (!spec.name) { toast("请填写名称"); return; }
  try {
    let j;
    if (spec.git) {
      if (!/^https?:\/\//.test(spec.url || "")) { toast("Git 仓库需 http(s) 地址"); return; }
      j = await apiImport(spec.url, spec.branch, spec.id);
    } else {
      if (spec.type === "link" && !/^https?:\/\//.test(spec.url || "")) { toast("link 型需 http(s) 地址"); return; }
      j = await apiCreate(spec);
    }
    const id = j.tool && j.tool.id;
    if (spec.type === "app" && id && selZip) await apiUploadZip(id, selZip);
    closeAdd();
    ["fName", "fUrl", "fId", "fDesc", "fGroup", "fIcon", "fCmd", "fPort", "fHealth", "fGitUrl", "fGitBranch"].forEach(x => { const el = document.getElementById(x); if (el) el.value = ""; });
    selZip = null; $("fZipInfo").textContent = "未选择";
    toast("已创建"); load();
  } catch (e) { toast(e.message); }
}

// manifest 在线校验(不写盘):POST 内容 → 显示错误/归一化结果
async function validateManifestUI() {
  const v = ($("fCmd").value || "").trim();
  let spec = collectSpec();
  if (spec.git) { toast("Git 模式无需校验"); return; }
  if (v && !spec.cmd) { try { spec.cmd = JSON.parse(v); } catch { toast("启动命令需 JSON 数组,如 [\"node\",\"server.mjs\"]"); return; } }
  const show = document.getElementById("fValidateResult");
  try {
    const j = await apiValidate(spec);
    if (show) {
      if (j.ok) {
        const n = j.normalized || {};
        show.innerHTML = `<span style="color:var(--ok,#2ea043)">✓ 配置有效</span> · ${n.type}${n.port ? " · :" + n.port : ""}${n.capabilities && n.capabilities.length ? " · 能力: " + n.capabilities.join("/") : ""}${n.runtime ? " · " + n.runtime : ""}`;
        show.style.display = "block"; show.style.color = "";
      } else {
        show.innerHTML = `<span style="color:#d1242f">✕ ${(j.errors || []).join("; ")}</span>`;
        show.style.display = "block";
      }
    } else toast(j.ok ? "✓ 配置有效" : (j.errors || []).join("; "));
  } catch (e) { toast("校验失败: " + e.message); }
}

/* ---------- 删除工具(确认弹层) ---------- */
let cfmResolve = null;
function cfmConfirm(msg) { return new Promise(r => { cfmResolve = r; $("cfmMsg").textContent = msg; $("cfmPass").value = ""; $("cfmMask").classList.add("show"); setTimeout(() => $("cfmPass").focus(), 100); }); }
function closeCfm(ok) { const pass = $("cfmPass").value; $("cfmMask").classList.remove("show"); if (cfmResolve) { cfmResolve(ok ? pass : null); cfmResolve = null; } }
$("cfmOk").addEventListener("click", () => closeCfm(!0));
$("cfmPass").addEventListener("keydown", e => { if (e.key === "Enter") closeCfm(!0); });
async function delTool(id, name) {
  const pass = await cfmConfirm("确认删除 " + name + " ?");
  if (!pass) return;
  try {
    const j = await apiDeleteTool(id, pass);
    toast(j.dirKept ? "已解除托管(挂载目录保留)" : "已删除");
    load();
  } catch (e) { toast(e.message); }
}

/* ---------- 管理员密码(首次设置 / 修改) ---------- */
async function checkAdminPass() {
  try {
    const j = await apiPass.status();
    if (!j.set) { $("adminMask").classList.add("show"); setTimeout(() => $("adminPass1").focus(), 200); }
  } catch {}
}
async function setAdminPass() {
  const p = $("adminPass1").value;
  if (!p || p.length < 4) { toast("密码至少 4 位"); return; }
  try {
    const j = await apiPass.set(p);
    if (!j.ok) throw new Error(j.error);
    $("adminMask").classList.remove("show"); toast("已设置");
  } catch (e) { toast(e.message); }
}
$("adminOk").addEventListener("click", setAdminPass);
$("adminPass1").addEventListener("keydown", e => { if (e.key === "Enter") setAdminPass(); });

async function openPass() { $("oldPass").value = ""; $("newPass1").value = ""; $("passMask").classList.add("show"); setTimeout(() => $("oldPass").focus(), 100); }
function closePass() { $("passMask").classList.remove("show"); }
async function changePass() {
  const oldP = $("oldPass").value, newP = $("newPass1").value;
  if (!newP || newP.length < 4) { toast("新密码至少 4 位"); return; }
  try {
    const j = await apiPass.change(oldP, newP);
    if (!j.ok) throw new Error(j.error);
    closePass(); toast("密码已修改");
  } catch (e) { toast(e.message); }
}
$("passOk").addEventListener("click", changePass);
$("newPass1").addEventListener("keydown", e => { if (e.key === "Enter") changePass(); });

/* ---------- 初始化 ---------- */
checkAdminPass();
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAdd(); closeDet(); } });
load();
