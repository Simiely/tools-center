// public/js/detail.js - 工具详情弹层(状态/日志/重启/暂停恢复)
// 依赖: ui.js(esc, capLabel, toast), api.js(apiRestart, apiPause)
let curDetail = null;

function openDetail(t) {
  curDetail = t;
  $("detIcon").textContent = t.icon || "🔧";
  $("detName").textContent = t.name;
  $("detId").textContent = t.id;
  $("detType").textContent = t.type === "link" ? "外部跳转" : "托管进程";
  $("detPort").textContent = t.type === "link" ? (t.url || "—") : (t.port || "—");
  const caps = (t.capabilities || []).map(c => `<span class="cap-chip ${esc(c)}">${esc(capLabel(c))}</span>`).join("");
  $("detCaps").innerHTML = caps || '<span style="color:var(--text3)">—</span>';
  const st = t.status || {};
  const stxt = t.type === "link" ? "链接" : (st.status === "running" ? "运行中" : (st.status === "stopped" ? "已停止" : (st.status || "—")));
  $("detStatus").textContent = (st.paused ? "⏸ 已暂停" : stxt) + " " + (st.health === "ok" && !st.paused ? "· 健康" : "");
  $("detDot").className = "card-dot " + (st.paused ? "warn" : (t.type === "link" ? "warn" : (st.status === "running" ? "ok" : (st.status === "error" ? "bad" : "warn"))));
  $("detErr").textContent = t.error || st.error || "—";
  $("detOpen").textContent = t.type === "link" ? "打开链接" : "打开界面";
  $("detRestart").style.display = (t.type === "app" && !st.paused) ? "" : "none";
  // 暂停/恢复按钮:app 型显示;文案随状态切换
  $("detPause").style.display = t.type === "app" ? "" : "none";
  $("detPause").textContent = st.paused ? "恢复" : "暂停";
  $("detMask").classList.add("show");
  loadLog();
}

function closeDet() { $("detMask").classList.remove("show"); curDetail = null; }

function openToolDetail() { if (curDetail) window.open(curDetail.type === "link" ? curDetail.url : "/tool/" + curDetail.id + "/", "_blank"); }

async function loadLog() {
  if (!curDetail) return;
  const id = curDetail.id;
  try {
    const j = await (await fetch("/api/logs/" + id, { cache: "no-store" })).json();
    const box = $("detLog");
    if (j.ok && j.lines && j.lines.length) box.innerHTML = j.lines.map(l => esc(l)).join("\n") || '<span class="log-empty">(空)</span>';
    else box.innerHTML = '<span class="log-empty">' + (j.error || "无日志") + "</span>";
    box.scrollTop = box.scrollHeight;
  } catch (e) { $("detLog").innerHTML = '<span class="log-empty">日志获取失败</span>'; }
}

async function restartTool() {
  if (!curDetail) return;
  try {
    await apiRestart(curDetail.id);
    toast("已重启"); setTimeout(() => { loadLog(); load(); }, 1500);
  } catch (e) { toast(e.message); }
}

/** 暂停/恢复工具:暂停 = 停止进程且不再自动拉起 */
async function togglePause() {
  if (!curDetail) return;
  const paused = !(curDetail.status && curDetail.status.paused);
  try {
    await apiPause(curDetail.id, paused);
    toast(paused ? "已暂停(不再自动运行)" : "已恢复运行");
    load();
  } catch (e) { toast(e.message); }
}
