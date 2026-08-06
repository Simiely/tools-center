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
    loadVersion(); // 底部版本号(确认更新是否生效)
  } catch (e) { $("main").innerHTML = `<div class="empty"><div class="empty-icon">!</div><p>${e.message}</p></div>`; }
}

/** 底部版本号:读 /api/version(镜像内 package.json),显示 "Tools Center v0.11.x" */
async function loadVersion() {
  try {
    const j = await (await fetch("/api/version", { cache: "no-store" })).json();
    $("footVer").textContent = "v" + (j.version || "?");
  } catch { $("footVer").textContent = "v?"; }
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
let advOpen = !1;
let __importDisabled = false; // import 模块关闭时(loadSettings 设置),禁止 zip/git 导入
function openAdd() { $("addMask").classList.add("show"); updatePreview(); }
function closeAdd() { hideImportBar(); $("addMask").classList.remove("show"); }

/* ---- 导入进度条(Git/zip 链接导入异步任务,2026-08-06) ---- */
function showImportBar() {
  const el = $("importBar"); if (!el) return;
  el.style.display = "block"; el.classList.remove("ib-err");
  $("importMsg").textContent = "正在导入…"; $("importPct").textContent = ""; $("importFill").style.width = "0%";
}
function setImportProgress(s) {
  const msg = $("importMsg"), pct = $("importPct"), fill = $("importFill");
  if (!msg || !s) return;
  if (s.message) msg.textContent = s.message;
  const p = typeof s.progress === "number" ? Math.max(0, Math.min(100, Math.round(s.progress))) : null;
  if (p !== null) { pct.textContent = p + "%"; fill.style.width = p + "%"; }
  if (s.status === "error") { const bar = $("importBar"); if (bar) bar.classList.add("ib-err"); }
}
function hideImportBar() { const el = $("importBar"); if (el) el.style.display = "none"; }
function setSavingUI(on) {
  const b = $("saveBtn"); if (!b) return;
  b.disabled = on;
  b.innerHTML = on
    ? "⏳ 导入中…"
    : '保存并启用<span style="font-weight:400;font-size:11px;opacity:.8">(自动识别输入)</span>';
}
function toggleAdv() { advOpen = !advOpen; $("fAdv").style.display = advOpen ? "" : "none"; $("advBtn").textContent = (advOpen ? "▾" : "▸") + " 高级设置"; updatePreview(); }

/* ---- 智能识别(v0.11.10):单输入自动判断类型 ---- */
const GIT_URL_RE = /github\.com|github\.cn|gitlab|gitee|gitcode|bitbucket|codeberg|sourceforge|\.git(\/|$)/i;
function detectInputType(text) {
  const t = (text || "").trim();
  if (!t) return { mode: "app", hint: "留空地址:命名创建空白模板,或拖入 zip 自动创建" };
  if (/^https?:\/\//i.test(t)) {
    if (/\.zip($|\?)/i.test(t)) return { mode: "zip", hint: "将下载 zip 并从 tool.json 自动创建/更新" };
    if (GIT_URL_RE.test(t)) return { mode: "git", hint: "将克隆仓库并自动托管运行" };
    return { mode: "link", hint: "将创建跳转卡片(不托管进程)" };
  }
  return { mode: "app", hint: "将创建空白模板(可拖入 zip 覆盖代码)" };
}
const DETECT_LABEL = { git: "Git 导入", zip: "zip 链接", link: "外部跳转", app: "托管进程" };

function renderDetect() {
  const d = $("fDetect"), branchRow = $("fGitBranchRow");
  if (!d) return;
  const det = detectInputType($("fInput").value);
  d.className = "detect d-" + det.mode;
  d.innerHTML = `<span class="d-tag">${DETECT_LABEL[det.mode]}</span>${det.hint}`;
  d.style.display = "";
  if (branchRow) branchRow.style.display = det.mode === "git" ? "" : "none";
  updatePreview();
}

function collectSpec() {
  const det = detectInputType($("fInput").value);
  const mode = det.mode;
  const s = { name: ($("fName").value || "").trim(), mode };
  if (mode === "zip" || mode === "git" || mode === "link") s.url = ($("fInput").value || "").trim();
  if (mode === "git") s.branch = ($("fGitBranch").value || "").trim();
  const a = { id: $("fId").value.trim(), desc: $("fDesc").value.trim(), group: $("fGroup").value.trim(), icon: $("fIcon").value.trim(), cmd: $("fCmd").value.trim(), port: $("fPort").value.trim(), health: $("fHealth").value.trim() };
  if (a.id) s.id = a.id;
  if (a.desc) s.desc = a.desc;
  if (a.group && a.group !== "工具") s.group = a.group;
  if (a.icon && a.icon !== "🔧") s.icon = a.icon;
  if (mode === "app") { if (a.cmd) { try { const c = JSON.parse(a.cmd); if (Array.isArray(c)) s.cmd = c; } catch {} } if (a.port) s.port = parseInt(a.port, 10); if (a.health) s.health = a.health; }
  return s;
}

function updatePreview() {
  const s = collectSpec();
  if (s.mode === "git") $("fPreview").textContent = `Git 导入: ${s.url || "(未填)"}${s.branch ? " @ " + s.branch : ""}`;
  else if (s.mode === "zip") $("fPreview").textContent = `zip 链接导入: ${s.url || "(未填)"}`;
  else if (s.mode === "link") $("fPreview").textContent = `外部跳转: ${s.url || "(未填)"} → ${s.name || "未命名"}`;
  else $("fPreview").textContent = JSON.stringify(s, null, 2);
}
["fName", "fInput", "fGitBranch", "fId", "fDesc", "fGroup", "fIcon", "fCmd", "fPort", "fHealth"].forEach(id => {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener("input", () => { if (id === "fInput") renderDetect(); else updatePreview(); });
});

let selZip = null;
function pickZip() { $("fZipInput").value = ""; $("fZipInput").click(); }
function handleDrop(files) { if (files.length) { selZip = files[0]; $("fZipInfo").textContent = selZip.name + " (" + Math.round(selZip.size / 1024) + " KB)"; } }
$("fZipInput").addEventListener("change", () => { const f = $("fZipInput").files[0]; if (f) { selZip = f; $("fZipInfo").textContent = f.name + " (" + Math.round(f.size / 1024) + " KB)"; } });

function resetAddForm() {
  ["fName", "fInput", "fGitBranch", "fId", "fDesc", "fCmd", "fPort", "fHealth"].forEach(x => { const el = document.getElementById(x); if (el) el.value = ""; });
  const g = $("fGroup"); if (g) g.value = "工具";
  const ic = $("fIcon"); if (ic) ic.value = "🔧";
  selZip = null; $("fZipInfo").textContent = "未选择";
  const d = $("fDetect"); if (d) d.style.display = "none";
  const br = $("fGitBranchRow"); if (br) br.style.display = "none";
}

/**
 * 覆盖升级/降级提示(2026-08-06):根据后端返回的 upgrade {from,to,direction} 区分提示。
 * direction: up=升级 / down=降级(旧版覆盖新版,警示) / same=同版本 / unknown=任一方无 version 字段
 */
function upgradeToast(j, createdText, updatedText) {
  if (j.created) return createdText;
  const u = j.upgrade;
  if (!u || u.direction === "unknown") return updatedText;
  if (u.direction === "up") return `已升级 ${u.from || "?"} → ${u.to}`;
  if (u.direction === "down") return `⚠️ 已回退 ${u.to} → ${u.from}(旧版覆盖了新版!)`;
  return `已覆盖(同版本 ${u.to})`;
}

let adding = false; // 防重复提交锁(连点会创建多个副本)
async function saveAdd() {
  if (adding) return; // 提交中,忽略重复点击
  const spec = collectSpec();
  const mode = spec.mode;
  // ① 拖了 zip → app zip 上传(优先级最高)
  if (selZip) {
    adding = true;
    try {
      const j = await apiUploadZipAuto(selZip);
      closeAdd();
      resetAddForm();
      toast(upgradeToast(j, "已从 zip 自动创建", "已用 zip 覆盖更新"));
      load();
    } catch (e) { toast(e.message); }
    finally { adding = false; }
    return;
  }
  // ② import 模块关闭时禁止 zip/git 导入
  if ((mode === "zip" || mode === "git") && __importDisabled) { toast("在线导入已关闭(功能 → import 可开启)"); return; }
  // ③ 在线导入(zip 链接 / git 仓库),异步任务 + 进度条,名称可留空
  if (mode === "zip" || mode === "git") {
    if (!/^https?:\/\//.test(spec.url || "")) { toast("Git 仓库 / zip 链接需 http(s) 地址"); return; }
    if (mode === "zip" && !/\.zip($|\?)/i.test(spec.url)) { toast("zip 链接需以 .zip 结尾"); return; }
    setSavingUI(true);
    showImportBar();
    onImportProgress = setImportProgress;
    try {
      const j = await apiImport(spec.url, spec.branch, spec.id);
      const created = j.created !== false;
      closeAdd();
      resetAddForm();
      toast(upgradeToast(j, "已从链接自动创建", "已用链接覆盖更新"));
      load();
    } finally { onImportProgress = null; hideImportBar(); setSavingUI(false); }
    return;
  }
  // ④ 本地创建(app 空白模板 / link 跳转卡片)
  if (mode === "link" && !/^https?:\/\//.test(spec.url || "")) { toast("外部跳转需 http(s) 地址"); return; }
  if (mode === "app" && !spec.name) { toast("请填写名称,或输入 URL / 拖入 zip"); return; }
  adding = true;
  try {
    const j = mode === "link" ? await apiCreate({ name: spec.name, type: "link", url: spec.url }) : await apiCreate(spec);
    closeAdd();
    resetAddForm();
    toast("已创建"); load();
  } catch (e) { toast(e.message); }
  finally { adding = false; }
}

// manifest 在线校验(不写盘):POST 内容 → 显示错误/归一化结果
async function validateManifestUI() {
  const v = ($("fCmd").value || "").trim();
  let spec = collectSpec();
  if (spec.mode === "git" || spec.mode === "zip") { toast("Git/zip 导入无需校验"); return; }
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

/* ---------- 管理员密码(可选:无密码时设置,有密码时修改/清除) ---------- */
// 打开弹窗时探测密码状态,切换「设置(无密码)」/「修改(有密码)」两种模式
async function openPass() {
  $("oldPass").value = ""; $("newPass1").value = ""; $("newPass2").value = "";
  let set = false;
  try { const s = await apiPass.status(); set = !!(s && s.set); } catch {}
  $("passTitle").textContent = set ? "修改管理员密码" : "设置管理员密码";
  $("passTip").textContent = set
    ? "留空新密码 = 清除密码(回到无密码状态)。"
    : "密码用于删除工具等敏感操作。留空新密码 = 无密码状态。";
  $("oldPass").style.display = set ? "" : "none";   // 已有密码才需要旧密码
  $("passMask").classList.add("show");
  setTimeout(() => (set ? $("oldPass") : $("newPass1")).focus(), 100);
}
function closePass() { $("passMask").classList.remove("show"); }
async function changePass() {
  const oldP = $("oldPass").value, newP = $("newPass1").value, newP2 = $("newPass2").value;
  if (newP !== newP2) { toast("两次输入的新密码不一致"); return; }
  try {
    const j = await apiPass.change(oldP, newP);
    if (!j.ok) throw new Error(j.error);
    closePass(); toast(newP ? "密码已设置/修改" : "已清除密码(无密码状态)");
  } catch (e) { toast(e.message); }
}
$("passOk").addEventListener("click", changePass);
$("newPass2").addEventListener("keydown", e => { if (e.key === "Enter") changePass(); });

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

/* ---------- 功能开关(v0.11.7):模块入口显隐 + 设置弹窗 ---------- */
async function loadSettings() {
  try {
    const j = await apiSettings.get();
    if (!j.ok) return;
    const m = j.modules || {};
    const hide = (id, off) => { if (off) { const b = document.getElementById(id); if (b) b.style.display = "none"; } };
    hide("btnDisk", m.storage === false);
    hide("btnBackup", m.backup === false);
    hide("btnPass", m.auth === false);
    hide("capStatus", m.capabilities === false);
    // import 关闭:隐藏 zip 拖拽 + 禁止在线导入识别(v0.11.10 统一入口;每次按当前开关重置)
    __importDisabled = m.import === false;
    const drop = document.getElementById("dropZone");
    if (drop) drop.style.display = __importDisabled ? "none" : "";
  } catch { /* 设置读取失败不影响主界面 */ }
}

function openSettings() {
  $("settingsMask").classList.add("show");
  $("settingsList").innerHTML = '<div class="tip" style="text-align:center;padding:16px">加载中…</div>';
  (async () => {
    try {
      const j = await apiSettings.get();
      if (!j.ok) throw new Error(j.error);
      const m = j.modules || {}, info = j.info || {};
      $("settingsList").innerHTML = Object.keys(m).map(k => {
        const i = info[k] || { name: k, desc: "" };
        return `<label style="display:flex;align-items:flex-start;gap:10px;padding:9px 6px;border-bottom:1px solid var(--line);cursor:pointer">
          <input type="checkbox" data-key="${esc(k)}" ${m[k] ? "checked" : ""} style="margin-top:2px">
          <span style="flex:1">
            <span style="font-size:12.5px;font-weight:500">${esc(i.name)}</span>
            <span style="display:block;font-size:10.5px;color:var(--text3);margin-top:2px">${esc(i.desc)}</span>
          </span>
        </label>`;
      }).join("");
    } catch (e) { $("settingsList").innerHTML = '<div class="tip" style="color:var(--bad)">' + esc(e.message) + '</div>'; }
  })();
}
function closeSettings() { $("settingsMask").classList.remove("show"); }

async function saveSettings() {
  const btn = $("settingsSaveBtn"); if (btn.disabled) return;
  const modules = {};
  document.querySelectorAll("#settingsList input[type=checkbox]").forEach(cb => { modules[cb.dataset.key] = cb.checked; });
  // 密码:已设置则要求输入(auth 关闭时后端免密)
  let pass = "";
  try { const s = await apiPass.status(); if (s && s.set) { pass = prompt("保存功能开关需要管理员密码:", ""); if (pass === null) return; } } catch {}
  btn.disabled = true;
  try {
    const j = await apiSettings.save(modules, pass || "");
    toast("已保存:即时生效");
    closeSettings();
    loadSettings(); // 当前页面立即按新开关刷新入口显隐(v0.11.9 动态生效)
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

/* ---------- 初始化 ---------- */
// 密码可选:初次登录不强制设置(不再自动弹窗),用户想用密码时点顶栏「密码」设置

/* ---- 存储管理大弹窗(2026-08-06:独立页 /disk.html 改回弹窗,复用 disk-page.js) ---- */
function openDisk() { $("diskMask").classList.add("show"); diskRefresh(); }
function closeDisk() { $("diskMask").classList.remove("show"); }

/* ---- 点击弹窗空白处(遮罩层本体)关闭(2026-08-06) ---- */
const MASK_CLOSERS = {
  addMask: closeAdd,
  detMask: closeDet,
  capMask: closeCap,
  cfmMask: () => closeCfm(false), // 密码确认框:点空白 = 取消
  passMask: closePass,
  tbMask: closeToolBackup,
  settingsMask: closeSettings,
  diskMask: closeDisk,
};
document.addEventListener("click", (e) => {
  const mask = e.target.closest ? e.target.closest(".mask") : null;
  if (!mask || e.target !== mask) return; // 仅点击遮罩空白处才关闭,点弹窗内容不关
  const closer = MASK_CLOSERS[mask.id];
  if (closer) closer();
});

document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAdd(); closeDet(); closeCap(); closeToolBackup(); closeSettings(); closeDisk(); } });
// 全局错误兜底(2026-08-06):任何 JS 错误/请求异常都 toast 提示,避免"点按钮无反应"难排查
window.addEventListener("error", (e) => { try { toast("脚本错误: " + ((e && (e.message || (e.error && e.error.message))) || "未知")); } catch {} });
window.addEventListener("unhandledrejection", (e) => { try { toast("请求异常: " + ((e && e.reason && (e.reason.message || e.reason)) || "未知")); } catch {} });
load();
loadSettings();
