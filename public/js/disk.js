// public/js/disk.js - 存储管理(磁盘残留清理):清单/分类/勾选/清理/恢复
// 依赖: ui.js(esc, toast), api.js(apiDisk, apiDeleteTool), app.js(load)
let diskItems = [], diskSel = {};

function openDiskMgr() { $("diskMask").classList.add("show"); diskRefresh(); }
function closeDiskMgr() { $("diskMask").classList.remove("show"); }

/** 分类 → 中文标签 HTML(单一职责:只出标签) */
function diskKindHtml(k) {
  const map = {
    managed: '<span style="color:var(--ok)">托管中</span>',
    invalid: '<span style="color:var(--warn)">无效配置</span>',
    removed: '<span style="color:var(--text2)">已解除托管</span>',
    ghost:   '<span style="color:var(--bad)">幽灵目录</span>',
  };
  return map[k] || esc(k);
}

/** 右侧状态词(单一职责:按 kind+paused 生成 {text, color}) */
function diskState(i) {
  switch (i.kind) {
    case "managed": return i.paused ? { text: "已暂停", color: "var(--warn)" } : { text: "运行中", color: "var(--ok)" };
    case "invalid": return { text: "不可用", color: "var(--warn)" };
    case "removed": return { text: "残留", color: "var(--text2)" };
    case "ghost":   return { text: "幽灵", color: "var(--bad)" };
    default:        return { text: "—", color: "var(--text3)" };
  }
}

/** 提示文案(单一职责:error 优先,否则按 kind+paused 组合) */
function diskHint(i) {
  if (i.error) return i.error;
  switch (i.kind) {
    case "managed": return i.paused ? "工具已暂停(不自动拉起);可在此删除" : "正常托管;点击删除会先停进程再清目录";
    case "invalid": return "配置无效(未扫描进注册表);可恢复或清理";
    case "removed": return "已解除托管(平台忽略此目录);可恢复识别或物理清理";
    case "ghost":   return "无 manifest.json/tool.json,扫描跳过;确认无用后可清理";
    default:        return "—";
  }
}

async function diskRefresh() {
  $("diskList").innerHTML = '<div class="tip" style="text-align:center;padding:20px">加载中…</div>';
  try {
    const j = await apiDisk.list();
    if (!j.ok) throw new Error(j.error);
    diskItems = j.items || [];
    diskSel = {};
    renderDiskList();
  } catch (e) { $("diskList").innerHTML = '<div class="tip" style="text-align:center;padding:20px">' + esc(e.message) + '</div>'; }
}

function renderDiskList() {
  const wrap = $("diskList");
  const stats = { managed: 0, invalid: 0, removed: 0, ghost: 0 };
  diskItems.forEach(i => { stats[i.kind] = (stats[i.kind] || 0) + 1; });
  $("diskStats").textContent = `托管 ${stats.managed} · 无效 ${stats.invalid} · 解除 ${stats.removed} · 幽灵 ${stats.ghost}`;
  // 图例说明(顶部提示增强)
  const legend = `
    <div style="font-size:10.5px;color:var(--text3);line-height:1.7;margin-bottom:6px;padding:6px 8px;background:var(--bg);border:1px solid var(--line);border-radius:6px">
      <b style="color:var(--text2)">分类说明:</b>
      <span style="color:var(--ok)">托管中</span>=正常工具(可删除);
      <span style="color:var(--warn)">无效配置</span>=配置损坏/端口冲突;
      <span style="color:var(--text2)">已解除托管</span>=删除残留目录;
      <span style="color:var(--bad)">幽灵目录</span>=无 manifest。
      勾选后可批量清理;托管中工具也可点「删除」。
    </div>`;
  if (!diskItems.length) { wrap.innerHTML = legend + '<div class="tip" style="text-align:center;padding:20px">tools/ 目录为空,无残留</div>'; $("diskCleanBtn").disabled = true; return; }
  wrap.innerHTML = legend + diskItems.map(i => {
    const sizeKB = Math.max(1, Math.round((i.size || 0) / 1024));
    const canRestore = i.kind === "removed" || i.kind === "invalid";
    const st = diskState(i);   // 右侧状态词
    const hint = diskHint(i);  // 提示文案
    // 元信息:类型 + 端口(托管/无效时有)
    const meta = [];
    if (i.type) meta.push(i.type === "link" ? "link" : "app");
    if (i.port) meta.push(":" + i.port);
    const metaTxt = meta.length ? " · " + meta.join(" ") : "";
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--line)">
      <input type="checkbox" data-dir="${esc(i.dir)}" onchange="diskToggle(this)" style="flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:500;word-break:break-all">${esc(i.name)} <span style="color:var(--text3);font-weight:400">(${esc(i.dir)})</span>${metaTxt}</div>
        <div style="font-size:10.5px;color:var(--text3);margin-top:2px;word-break:break-all;line-height:1.5">
          ${esc(hint)}
        </div>
      </div>
      <span style="font-size:10.5px;color:var(--text3);flex-shrink:0">${sizeKB} KB</span>
      <span style="font-size:10.5px;font-weight:600;color:${st.color};flex-shrink:0;min-width:34px;text-align:center">${esc(st.text)}</span>
      ${diskKindHtml(i.kind)}
      ${canRestore ? `<button class="btn sm" onclick="diskRestore('${esc(i.dir)}')" title="重新识别为托管工具">恢复</button>` : ""}
      ${i.kind === "managed" ? `<button class="btn sm danger" onclick="diskDeleteManaged('${esc(i.dir)}','${esc(i.name)}')" title="删除此工具(先停进程)">删除</button>` : ""}
    </div>`;
  }).join("");
  $("diskCleanBtn").disabled = true;
}

function diskToggle(el) {
  const dir = el.dataset.dir;
  if (el.checked) diskSel[dir] = true; else delete diskSel[dir];
  $("diskCleanBtn").disabled = !Object.keys(diskSel).length;
}

async function diskRestore(dir) {
  try {
    await apiDisk.restore(dir);
    toast("已恢复托管: " + dir);
    diskRefresh();
    load();
  } catch (e) { toast(e.message); }
}

/** 探测是否设置过密码(无密码时清理不需要密码) */
async function diskPassSet() {
  try { const s = await apiPass.status(); return !!(s && s.set); } catch { return true; }
}

/** 删除托管中的工具(先停进程,密码确认;复用首页删除逻辑) */
async function diskDeleteManaged(dir, name) {
  const needPass = await diskPassSet();
  const msg = "删除工具「" + name + "」(目录将被物理删除,不可恢复)。" + (needPass ? "\n输入管理员密码:" : "\n无密码,直接确认删除:");
  const pass = needPass ? prompt(msg, "") : (confirm(msg) ? true : null);
  if (pass === null || pass === false) return;
  try {
    await apiDeleteTool(dir, pass || "");
    toast("已删除: " + name);
    diskRefresh();
    load();
  } catch (e) { toast(e.message); }
}

async function diskCleanSelected() {
  const dirs = Object.keys(diskSel);
  if (!dirs.length) return;
  const needPass = await diskPassSet();
  const msg = "输入管理员密码以清理 " + dirs.length + " 个残留目录(删除不可恢复):";
  const pass = needPass ? prompt(msg, "") : (confirm("确认清理 " + dirs.length + " 个残留目录(删除不可恢复)?") ? true : null);
  if (pass === null || pass === false) return;
  try {
    const j = await apiDisk.clean(dirs, pass || "");
    const ok = (j.results || []).filter(r => r.removed).length;
    const kept = (j.results || []).filter(r => r.dirKept).length;
    toast("已清理 " + ok + " 个" + (kept ? ", " + kept + " 个被占用已转解除托管" : ""));
    diskSel = {};
    diskRefresh();
    load();
  } catch (e) { toast(e.message); }
}
