// public/js/disk-page.js - 应用管理(首页大弹窗渲染,v0.12.2 由"存储管理"更名):程序一列 / 数据一列 分列管理 + 应用显示信息编辑
// 依赖: api.js($, toast, apiDisk, apiDeleteTool, apiPass, apiToolBackup, apiToolMeta), ui.js(esc)
// v0.11.6:清理/删除前自动备份(后端),数据残留(dataAlone)醒目标注,数据可单独清理。
// v0.12.2:更名"应用管理";托管中应用新增「✏️ 编辑」(名称/图标/分组/描述,写回 tool.json)。
let diskItems = [];

function fmtSize(n) {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return (d.getMonth() + 1) + "-" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function kindBadge(kind) {
  const map = { managed: ["b-managed", "托管中"], invalid: ["b-invalid", "无效配置"], removed: ["b-removed", "已解除托管"], ghost: ["b-ghost", "幽灵目录"] };
  const [cls, txt] = map[kind] || ["", kind];
  return `<span class="badge ${cls}">${txt}</span>`;
}

async function diskRefresh() {
  $("diskList").innerHTML = '<div class="ph">加载中…</div>';
  try {
    const j = await apiDisk.list();
    if (!j.ok) throw new Error(j.error);
    diskItems = j.items || [];
    render();
  } catch (e) { $("diskList").innerHTML = '<div class="ph">' + esc(e.message) + '</div>'; }
}

function render() {
  let managed = 0, dataSize = 0, reclaim = 0, progSize = 0, junkSize = 0;
  for (const i of diskItems) {
    dataSize += i.dataSize || 0; progSize += i.progSize || 0; junkSize += i.junkSize || 0;
    if (i.kind === "managed") managed++;
    if (i.dataAlone) reclaim += i.dataSize || 0;
  }
  $("diskStats").innerHTML = `
    <div class="stat"><div class="s-label">工具目录</div><div class="s-val">${diskItems.length}<small>个</small></div></div>
    <div class="stat"><div class="s-label">托管中</div><div class="s-val">${managed}<small>个</small></div></div>
    <div class="stat"><div class="s-label">程序占用</div><div class="s-val">${fmtSize(progSize)}</div></div>
    <div class="stat"><div class="s-label">数据占用</div><div class="s-val">${fmtSize(dataSize)}<small>垃圾 ${fmtSize(junkSize)}</small></div></div>
    <div class="stat reclaim"><div class="s-label">⚠️ 数据残留可回收</div><div class="s-val">${fmtSize(reclaim)}<small>${reclaim > 0 ? "程序已删,数据仍在" : "无"}</small></div></div>`;
  if (!diskItems.length) { $("diskList").innerHTML = '<div class="ph">tools/ 目录为空,无残留</div>'; return; }
  $("diskList").innerHTML = diskItems.map(diskCardHtml).join("");
}

// 注意:命名带 disk 前缀——与 cards.js 的 cardHtml(首页工具卡片)重名会覆盖,导致首页卡片渲染错乱
function diskCardHtml(i) {
  const typeTxt = i.type ? (i.type === "link" ? "link" : "app" + (i.port ? " :" + i.port : "")) : "—";
  const progCol = `
    <div class="tc-col prog">
      <div class="tc-title">程序 <span class="tag">${typeTxt}</span>${kindBadge(i.kind)}</div>
      <div class="tc-name">${esc(i.name)}<small>${esc(i.dir)}</small></div>
      <div class="tc-meta">程序体积 <b>${fmtSize(i.progSize)}</b>${i.hasManifest ? " · 可重建(zip/git)" : " · 无声明文件"}</div>
      ${i.mount ? '<div class="tc-meta" style="color:var(--warn)">⚠️ 独立挂载点:平台无法物理删除,需在宿主层处理</div>' : ""}
      ${i.error ? '<div class="tc-meta" style="color:var(--warn)">' + esc(i.error) + "</div>" : ""}
      <div class="tc-acts">${progActs(i)}</div>
    </div>`;
  const dataCol = `
    <div class="tc-col">
      <div class="tc-title">数据 ${i.dataSize ? '<span class="tag">' + fmtSize(i.dataSize) + "</span>" : ""}${i.junkSize ? '<span class="tag b-junk">垃圾 ' + fmtSize(i.junkSize) + "</span>" : ""}</div>
      ${i.dataAlone ? '<div class="alone-warn">⚠️ 程序已不存在,数据仍占用 <b>' + fmtSize(i.dataSize) + "</b>,可单独清理回收</div>" : ""}
      ${dataBody(i)}
      <div class="tc-acts">${dataActs(i)}</div>
    </div>`;
  return `<div class="tool-card"><div class="tc-grid">${progCol}${dataCol}</div></div>`;
}

function dataBody(i) {
  if (!i.dataFiles || !i.dataFiles.length) return '<div class="df-empty">无数据文件</div>';
  const rows = i.dataFiles.map(f => `<div class="df-row"><span>${esc(f.rel)}</span><span>${fmtSize(f.size)}</span></div>`).join("");
  return `<div class="df-list">${rows}</div><div class="df-sum">数据合计 <b>${fmtSize(i.dataSize)}</b>${i.junkSize ? " · 垃圾 " + fmtSize(i.junkSize) : ""}</div>`;
}

function progActs(i) {
  const btns = [];
  if (i.kind === "managed") {
    btns.push(`<button class="btn sm" onclick="openMetaEdit('${esc(i.dir)}')" title="修改名称/图标/分组/描述(首页显示内容)">✏️ 编辑</button>`);
    btns.push(`<button class="btn sm danger" onclick="diskDelete('${esc(i.dir)}','${esc(i.name)}')">删除工具</button>`);
  }
  if (i.kind === "removed" || i.kind === "invalid") btns.push(`<button class="btn sm" onclick="diskRestore('${esc(i.dir)}')">恢复托管</button>`);
  if ((i.kind === "removed" || i.kind === "ghost" || i.kind === "invalid") && !i.mount) {
    btns.push(`<button class="btn sm danger" onclick="diskCleanDir('${esc(i.dir)}')">清理目录</button>`);
  }
  return btns.join("");
}

function dataActs(i) {
  if (!(i.dataSize > 0)) return "";
  return `<button class="btn sm danger" onclick="diskCleanData('${esc(i.dir)}','${esc(i.name)}')">清理数据</button>`;
}

/* ---------- 密码与确认 ---------- */
async function needPass() { try { const s = await apiPass.status(); return !!(s && s.set); } catch { return true; } }

async function askPass(msg) {
  const np = await needPass();
  return np ? prompt(msg, "") : (confirm(msg) ? true : null);
}

function toastBackup(b) {
  if (b && b.file) toast("已自动备份 " + b.file + "(" + fmtSize(b.size) + "),可还原");
}

/* ---------- 操作 ---------- */
async function diskDelete(dir, name) {
  const np = await needPass();
  const pass = await askPass("删除工具「" + name + "」(程序+数据将一并删除)。\n清理前自动备份,可还原。\n" + (np ? "输入管理员密码:" : "确认删除?"));
  if (pass === null) return;
  try {
    const j = await apiDeleteTool(dir, pass === true ? "" : pass);
    toastBackup(j.backup);
    toast("已删除: " + name + (j.dirKept ? "(目录保留)" : ""));
    diskRefresh();
  } catch (e) { toast(e.message); }
}

async function diskRestore(dir) {
  try { await apiDisk.restore(dir); toast("已恢复托管: " + dir); diskRefresh(); }
  catch (e) { toast(e.message); }
}

async function diskCleanDir(dir) {
  const np = await needPass();
  const pass = await askPass("清理目录「" + dir + "」(物理删除)。\n清理前自动备份,可还原。\n" + (np ? "输入管理员密码:" : "确认清理?"));
  if (pass === null) return;
  try {
    const j = await apiDisk.clean([dir], pass === true ? "" : pass);
    toastBackup(j.backup);
    const r = (j.results || [])[0];
    toast(r && r.removed ? "已清理: " + dir : "清理失败: " + ((r && r.error) || "未知"));
    diskRefresh();
  } catch (e) { toast(e.message); }
}

async function diskCleanData(dir, name) {
  const item = diskItems.find(i => i.dir === dir);
  if (!item || !item.dataFiles || !item.dataFiles.length) { toast("无数据可清理"); return; }
  const files = item.dataFiles.map(f => "  · " + f.rel + " (" + fmtSize(f.size) + ")").join("\n");
  const np = await needPass();
  const pass = await askPass("清理「" + name + "」的数据文件(保留程序代码):\n" + files + "\n合计 " + fmtSize(item.dataSize) + "。清理前自动备份,可还原。\n" + (np ? "输入管理员密码:" : "确认清理数据?"));
  if (pass === null) return;
  try {
    const j = await apiDisk.cleanData(dir, pass === true ? "" : pass);
    toastBackup(j.backup);
    toast(j.removed.length + " 个数据文件已清理" + (j.error ? "(" + j.error + ")" : ""));
    diskRefresh();
  } catch (e) { toast(e.message); }
}

async function openDiskBackup() {
  try { const j = await apiToolBackup.create(); toast("已备份 " + j.tools.length + " 个工具 → " + j.file); }
  catch (e) { toast(e.message); }
}

/* ---------- 应用信息编辑(v0.12.2:名称/图标/分组/描述,写回 tool.json) ---------- */
let metaEditingDir = "";
function openMetaEdit(dir) {
  const i = diskItems.find(x => x.dir === dir);
  if (!i) { toast("未找到应用: " + dir); return; }
  metaEditingDir = dir;
  $("mName").value = i.name || "";
  $("mIcon").value = i.icon || "🧰";
  $("mGroup").value = i.group || "工具";
  $("mDesc").value = i.desc || "";
  $("metaMask").classList.add("show");
  $("mName").focus();
}
function closeMeta() { $("metaMask").classList.remove("show"); }
async function saveMeta() {
  const name = $("mName").value.trim();
  if (!name) { toast("名称不能为空"); $("mName").focus(); return; }
  const btn = $("metaSaveBtn");
  btn.disabled = true;
  try {
    const j = await apiToolMeta.update(metaEditingDir, {
      name, icon: $("mIcon").value.trim(), group: $("mGroup").value.trim(), desc: $("mDesc").value.trim(),
    });
    toast("已保存: " + (j.tool && j.tool.name ? j.tool.name : name));
    closeMeta();
    diskRefresh();  // 应用管理列表刷新
    load();         // 首页卡片/分类同步刷新(全局函数,app.js)
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

diskRefresh();
