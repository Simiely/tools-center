// public/js/app.js - 主逻辑:加载/添加工具/密码/事件绑定/初始化
// 依赖: api.js($, toast, api*), ui.js(esc/capLabel/loadCaps), cards.js(renderTabs/renderCards),
//       detail.js(openDetail/loadLog), disk.js(openDiskMgr)

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
  // 卡片左上角控制按钮:暂停/恢复、重启(不打开工具)
  const ctl = e.target.closest(".ctl-btn");
  if (ctl) {
    e.stopPropagation();
    const id = ctl.dataset.id;
    if (ctl.dataset.act === "pause") cardTogglePause(id, ctl.dataset.paused === "1");
    else if (ctl.dataset.act === "restart") cardRestart(id);
    return;
  }
  // 详情按钮(卡片左下 ⓘ):点击才弹详情;卡片本体直接打开工具
  const info = e.target.closest(".info-btn");
  if (info) {
    e.stopPropagation();
    const t = (window.__tools || []).find(x => x.id === info.dataset.id);
    if (t) openDetail(t);
    return;
  }
  const card = e.target.closest(".card");
  if (!card) return;
  const t = (window.__tools || []).find(x => x.id === card.dataset.id);
  if (t) openTool(t); // 直接打开,不弹窗
});

/** 直接打开工具(app 反代 /link 新标签页) */
function openTool(t) {
  window.open(t.type === "link" ? t.url : "/tool/" + t.id + "/", "_blank");
}

/** 卡片上的暂停/恢复(不弹详情,直接切换) */
async function cardTogglePause(id, paused) {
  try {
    await apiPause(id, !paused);
    toast(!paused ? "已暂停" : "已恢复");
    load();
  } catch (e) { toast(e.message); }
}

/** 卡片上的重启(不弹详情) */
async function cardRestart(id) {
  try {
    await apiRestart(id);
    toast("已重启");
    setTimeout(load, 800);
  } catch (e) { toast(e.message); }
}

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

let adding = false; // 防重复提交锁(连点会创建多个副本)
async function saveAdd() {
  if (adding) return; // 提交中,忽略重复点击
  const spec = collectSpec();
  if (!spec.name) { toast("请填写名称"); return; }
  adding = true;
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
  finally { adding = false; } // 无论成败都解锁(下次可再添加)
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
// needPass=true 时显示密码框;无密码状态下不显示,直接确认即删
function cfmConfirm(msg, needPass) {
  return new Promise(r => {
    cfmResolve = r;
    $("cfmMsg").textContent = msg;
    $("cfmPass").style.display = needPass ? "" : "none";
    $("cfmPass").value = "";
    $("cfmMask").classList.add("show");
    if (needPass) setTimeout(() => $("cfmPass").focus(), 100);
  });
}
function closeCfm(ok) { const pass = $("cfmPass").value; $("cfmMask").classList.remove("show"); if (cfmResolve) { cfmResolve(ok ? pass : null); cfmResolve = null; } }
$("cfmOk").addEventListener("click", () => closeCfm(!0));
$("cfmPass").addEventListener("keydown", e => { if (e.key === "Enter") closeCfm(!0); });
async function delTool(id, name) {
  // 删除前探测:① 工具是否仍存在于注册表(幽灵卡片 = 前端有卡片但后端查无此人) ② 是否设置过密码
  let ghost = false, needPass = false;
  try {
    const [probe, pst] = await Promise.all([getJSON("/api/tools/" + id), apiPass.status().catch(() => null)]);
    ghost = !(probe && probe.ok && probe.tool);
    needPass = !!(pst && pst.set);
  } catch { ghost = true; }
  // 幽灵卡片在确认弹窗(输密码处)就明示,避免用户误以为在删正常工具
  const pass = await cfmConfirm(
    ghost
      ? "⚠️ 该工具已不存在(残留卡片),删除仅清理前端记录,不影响数据。\n确认删除 " + name + " ?"
      : "确认删除 " + name + " ?",
    needPass
  );
  if (pass === null) return;   // 用户取消
  try {
    const j = await apiDeleteTool(id, pass || "");
    toast(j.dirKept ? "已解除托管(挂载目录保留)" : "已删除");
  } catch (e) {
    // 兜底:删除失败(如工具已不在注册表)也刷新列表,幽灵卡片随之消失
    toast(e.message);
  } finally {
    load();
  }
}

/* ---------- 管理员密码(可选:初次不强制,想用才设置;空 = 无密码) ---------- */
// 初次登录不再强制设置密码:去掉自动弹窗,用户想设置时点顶栏「密码」即可
async function setAdminPass() {
  const p = $("adminPass1").value;
  try {
    const j = await apiPass.set(p);
    if (!j.ok) throw new Error(j.error);
    $("adminMask").classList.remove("show"); toast(p ? "已设置密码" : "已清除密码(无密码状态)");
  } catch (e) { toast(e.message); }
}
$("adminOk").addEventListener("click", setAdminPass);
$("adminPass1").addEventListener("keydown", e => { if (e.key === "Enter") setAdminPass(); });

async function openPass() { $("oldPass").value = ""; $("newPass1").value = ""; $("passMask").classList.add("show"); setTimeout(() => $("oldPass").focus(), 100); }
function closePass() { $("passMask").classList.remove("show"); }
async function changePass() {
  const oldP = $("oldPass").value, newP = $("newPass1").value;
  try {
    const j = await apiPass.change(oldP, newP);
    if (!j.ok) throw new Error(j.error);
    closePass(); toast(newP ? "密码已修改" : "已清除密码(无密码状态)");
  } catch (e) { toast(e.message); }
}
$("passOk").addEventListener("click", changePass);
$("newPass1").addEventListener("keydown", e => { if (e.key === "Enter") changePass(); });

/* ---------- 工具备份/恢复 ---------- */
let tbBackups = [];       // 当前备份列表
let tbSelected = {};      // { 备份file: { 工具id: 是否勾选 } }

function openToolBackup() {
  $("tbMask").classList.add("show");
  tbRefresh();
}
function closeToolBackup() { $("tbMask").classList.remove("show"); }

async function tbRefresh() {
  $("tbList").innerHTML = '<div class="tip" style="text-align:center;padding:20px">加载中…</div>';
  try {
    const j = await apiToolBackup.list();
    if (!j.ok) throw new Error(j.error);
    tbBackups = j.backups || [];
    renderTbList();
  } catch (e) { $("tbList").innerHTML = '<div class="tip" style="text-align:center;padding:20px">' + esc(e.message) + '</div>'; }
}

function renderTbList() {
  const wrap = $("tbList");
  if (!tbBackups.length) { wrap.innerHTML = '<div class="tip" style="text-align:center;padding:20px">暂无备份,点击「立即备份」创建</div>'; return; }
  tbSelected = {};
  wrap.innerHTML = tbBackups.map((bk) => {
    const ts = (bk.ts || "").replace("T", " ").replace("Z", "");
    const sizeKB = Math.max(1, Math.round((bk.size || 0) / 1024));
    const toolList = (bk.tools || []).map((id) =>
      `<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px;cursor:pointer">
        <input type="checkbox" data-bk="${esc(bk.file)}" data-tool="${esc(id)}" onchange="tbToggle(this)">
        ${esc(id)}
      </label>`).join("") || '<span style="color:var(--text3)">(空)</span>';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:12px;font-weight:500">${esc(ts)}</span>
        <span style="display:flex;gap:8px;align-items:center">
          <span style="font-size:11px;color:var(--text3)">${sizeKB} KB · ${(bk.tools || []).length} 工具</span>
          <a href="${apiToolBackup.downloadUrl(bk.file)}" download style="font-size:11px;color:var(--brand);text-decoration:none">下载</a>
          <button class="btn sm danger" onclick="tbDel('${esc(bk.file)}')" title="删除此备份">删除</button>
        </span>
      </div>
      <div style="font-size:12px">${toolList}</div>
    </div>`;
  }).join("");
}

/** 删除一个备份(物理删除 zip,不可恢复) */
async function tbDel(file) {
  if (!confirm("确认删除备份 " + file + " ?\n此操作不可恢复!")) return;
  try {
    const j = await apiToolBackup.del(file);
    toast(j.deleted ? "已删除备份" : "备份不存在(已清理)");
    await tbRefresh();
  } catch (e) { toast(e.message); }
}

function tbToggle(el) {
  const bk = el.dataset.bk, tool = el.dataset.tool;
  if (!tbSelected[bk]) tbSelected[bk] = {};
  tbSelected[bk][tool] = el.checked;
  $("tbRestoreBtn").disabled = !Object.values(tbSelected).some((m) => Object.values(m).some(Boolean));
}

async function tbCreate() {
  const btn = $("tbCreateBtn");
  btn.disabled = true; btn.textContent = "备份中…";
  try {
    const j = await apiToolBackup.create();
    toast("备份完成: " + (j.tools || []).length + " 个工具");
    await tbRefresh();
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = "立即备份";
}

async function tbRestoreSelected() {
  // 收集勾选:按备份分组
  const groups = [];
  for (const [bk, m] of Object.entries(tbSelected)) {
    const tools = Object.keys(m).filter((t) => m[t]);
    if (tools.length) groups.push({ backup: bk, tools });
  }
  if (!groups.length) { toast("请先勾选要恢复的工具"); return; }
  const total = groups.reduce((s, g) => s + g.tools.length, 0);
  if (!confirm("从备份恢复 " + total + " 个工具?\n已存在的工具会先自动备份为 .pre-restore- 目录。")) return;
  try {
    let restored = 0;
    for (const g of groups) {
      const j = await apiToolBackup.restore(g.backup, g.tools);
      restored += (j.restored || []).length;
    }
    toast("已恢复 " + restored + " 个工具");
    closeToolBackup();
    load();
  } catch (e) { toast(e.message); }
}

/* ---------- 初始化 ---------- */
// 密码可选:初次登录不强制设置(不再自动弹窗),用户想用密码时点顶栏「密码」设置
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAdd(); closeDet(); closeToolBackup(); } });
load();
