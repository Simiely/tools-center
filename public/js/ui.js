// public/js/ui.js - 渲染与 UI 工具:esc/toast/capLabel/卡片/详情弹层/能力弹层
// 依赖: api.js(全局函数 $, toast)

/** HTML 转义(防注入) */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/** 能力名 → 中文标签 */
function capLabel(c) { return c === "browser" ? "🌐 浏览器" : c === "storage" ? "💾 存储" : c === "network" ? "🌍 网络" : c; }

/* ---------- 顶栏能力指示器 ---------- */
async function loadCaps() {
  try {
    const j = await (await fetch("/api/capabilities", { cache: "no-store" })).json();
    if (!j.ok) return;
    const caps = j.capabilities || [];
    const pill = $("capStatus");
    const errors = caps.filter(c => c.status === "error");
    const running = caps.filter(c => c.status === "running").length;
    if (errors.length) {
      pill.textContent = "⚠ " + errors.length + " 能力异常";
      pill.className = "cap-pill has-err";
      pill.dataset.err = errors.map(c => c.name + ": " + (c.error || "未知")).join("\n");
    } else {
      const total = caps.length;
      pill.textContent = "✓ " + (total ? running + "/" + total + " 能力" : "无能力");
      pill.className = "cap-pill " + (running ? "all-ok" : "");
    }
  } catch {}
}

/* ---------- 能力详情弹层 ---------- */
async function openCapDetail() {
  $("capMask").classList.add("show");
  try {
    const j = await (await fetch("/api/capabilities", { cache: "no-store" })).json();
    const caps = (j.capabilities || []);
    $("capList").innerHTML = caps.map(c => {
      const ok = c.status === "running";
      const err = c.status === "error";
      const idle = c.status === "idle";
      const col = ok ? "var(--ok)" : (err ? "var(--bad)" : "var(--text3)");
      return `<div style="padding:8px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:13px;font-weight:500">${esc(capLabel(c.name))}</div><div style="font-size:10.5px;color:var(--text3)">${esc(c.error || (ok ? "已启动" : (idle ? "未启动" : "启动中")))}</div></div>
        <span style="font-size:11px;color:${col};font-weight:600">${esc(c.status).toUpperCase()}</span>
      </div>`}).join("") || '<div style="text-align:center;color:var(--text3);padding:20px">暂无能力</div>';
  } catch (e) { $("capList").textContent = "加载失败"; }
}
function closeCap() { $("capMask").classList.remove("show"); }

/* ---------- 工具列表渲染 ---------- */
let tools = [], activeCat = "all", activeCap = "";

function renderTabs() {
  const cats = [...new Set(tools.map(t => t.group || "工具"))];
  const caps = [...new Set(tools.flatMap(t => t.capabilities || []))];
  $("tabs").querySelector(".tabs-inner").innerHTML =
    `<button class="tab ${activeCat === "all" && !activeCap ? "on" : ""}" data-cat="all" data-cap="" onclick="setCat('all','')">全部</button>` +
    caps.map(c => `<button class="tab ${activeCap === c ? "on" : ""}" data-cap="${esc(c)}" onclick="setCat('', this.dataset.cap)">${esc(capLabel(c))}</button>`).join("") +
    cats.filter(c => c !== "全部").map(c => `<button class="tab ${activeCat === c ? "on" : ""}" data-cat="${esc(c)}" onclick="setCat(this.dataset.cat,'')">${esc(c)}</button>`).join("");
}

function setCat(c, cap) { activeCat = c; activeCap = cap; renderTabs(); renderCards(); }

function renderCards() {
  let filtered = tools;
  if (activeCap) filtered = filtered.filter(t => (t.capabilities || []).includes(activeCap));
  if (activeCat && activeCat !== "all") filtered = filtered.filter(t => (t.group || "工具") === activeCat);
  if (!filtered.length) { $("main").innerHTML = '<div class="empty"><div class="empty-icon">&#x1F50D;</div><p>无匹配工具</p></div>'; return; }
  window.__tools = filtered;
  const groups = {};
  for (const t of filtered) (groups[t.group || "工具"] = groups[t.group || "工具"] || []).push(t);
  $("main").innerHTML = Object.entries(groups).map(([g, arr]) =>
    `<div class="sec"><div class="sec-title">${esc(g)} <span class="count">${arr.length}</span></div><div class="grid">${arr.map(cardHtml).join("")}</div></div>`).join("");
}

function cardHtml(t) {
  const st = t.status || {};
  const dotCls = t.type === "link" ? "warn" : (st.status === "running" ? "ok" : (st.status === "error" ? "bad" : "warn"));
  const stxt = t.type === "link" ? "链接" : (st.status === "running" ? "运行" : (st.status || "—"));
  const caps = (t.capabilities || []).map(c => `<span class="cap-chip ${esc(c)}">${esc(capLabel(c))}</span>`).join("");
  return `<div class="card" data-id="${esc(t.id)}">
    <span class="card-tag ${t.type === "app" ? "hosted" : "link"}">${t.type === "app" ? "托管" : "链接"}</span>
    <div class="card-icon">${esc(t.icon || "🧰")}</div>
    <div class="card-name">${esc(t.name)}</div>
    <div class="card-desc">${esc(t.desc || "")}</div>
    ${caps ? `<div class="caps">${caps}</div>` : ""}
    <div class="card-foot"><span class="card-dot ${dotCls}"></span>${stxt}</div>
    <button class="del-btn" data-id="${esc(t.id)}" data-name="${esc(t.name)}" title="删除">&#x1F5D1;</button>
  </div>`;
}

/* ---------- 工具详情弹层 ---------- */
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
  $("detStatus").textContent = stxt + " " + (st.health === "ok" ? "· 健康" : "");
  $("detDot").className = "card-dot " + (t.type === "link" ? "warn" : (st.status === "running" ? "ok" : (st.status === "error" ? "bad" : "warn")));
  $("detErr").textContent = t.error || st.error || "—";
  $("detOpen").textContent = t.type === "link" ? "打开链接" : "打开界面";
  $("detRestart").style.display = t.type === "app" ? "" : "none";
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
