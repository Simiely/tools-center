// public/js/ui.js - 基础 UI 工具与顶栏:esc/toast/capLabel/能力指示器/能力弹层
// 依赖: api.js(全局函数 $, toast)
// 工具列表渲染 → cards.js;详情弹层 → detail.js;存储管理 → disk-page.js(首页大弹窗)

/** HTML 转义(防注入) */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/**
 * 刷新按钮通用交互(2026-08-06):点击后按钮加 spinning(尾部旋转图标 + 禁用防连点),
 * 并 toast 弹出动作说明;请求完成后自动恢复。所有「刷新」类按钮统一走这里。
 * @param {string} btnId 按钮 id(需在 HTML 中给按钮加 id)
 * @param {Function} fn 刷新函数(async,完成后恢复按钮)
 * @param {string} [startMsg] 点击时弹出的动作说明,默认「正在刷新…」
 * @param {string} [doneMsg] 完成后的提示,留空则不提示
 */
async function btnSpin(btnId, fn, startMsg = "正在刷新…", doneMsg = "") {
  const btn = $(btnId);
  if (!btn || btn.disabled) return; // 防连点:进行中忽略再次点击
  btn.disabled = true;
  btn.classList.add("spinning");
  if (startMsg) toast(startMsg);
  try { await fn(); }
  catch { /* 刷新函数内部已容错;仅保证按钮恢复 */ }
  finally {
    btn.disabled = false;
    btn.classList.remove("spinning");
    if (doneMsg) toast(doneMsg);
  }
}

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
