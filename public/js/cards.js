// public/js/cards.js - 工具列表渲染(分组/分类过滤/卡片 HTML)
// 依赖: ui.js(esc, capLabel)
let tools = [], activeCat = "all", activeCap = "";

function renderTabs() {
  const cats = [...new Set(tools.map(t => t.group || "工具"))];
  const caps = [...new Set(tools.flatMap(t => t.capabilities || []))];
  // 单分类自动隐藏分类 tab(2026-08-06):所有工具同属一个分类时只留「全部」,避免"全部+唯一分类"冗余;≥2 个分类才显示
  const showCats = cats.filter(c => c !== "全部").length > 1;
  if (!showCats && activeCat !== "all") { activeCat = "all"; renderCards(); }
  $("tabs").querySelector(".tabs-inner").innerHTML =
    `<button class="tab ${activeCat === "all" && !activeCap ? "on" : ""}" data-cat="all" data-cap="" onclick="setCat('all','')">全部</button>` +
    caps.map(c => `<button class="tab ${activeCap === c ? "on" : ""}" data-cap="${esc(c)}" onclick="setCat('', this.dataset.cap)">${esc(capLabel(c))}</button>`).join("") +
    (showCats ? cats.filter(c => c !== "全部").map(c => `<button class="tab ${activeCat === c ? "on" : ""}" data-cat="${esc(c)}" onclick="setCat(this.dataset.cat,'')">${esc(c)}</button>`).join("") : "");
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
  const dotCls = t.type === "link" ? "warn" : (st.paused ? "warn" : (st.status === "running" ? "ok" : (st.status === "error" ? "bad" : "warn")));
  const stxt = t.type === "link" ? "链接" : (st.paused ? "已暂停" : (st.status === "running" ? "运行" : (st.status || "—")));
  const caps = (t.capabilities || []).map(c => `<span class="cap-chip ${esc(c)}">${esc(capLabel(c))}</span>`).join("");
  // 卡片左上角操作组(app 型):暂停/恢复 + 重启,点击不打开工具
  const ctlBtns = t.type === "app" ? `
    <span class="card-ctl">
      <button class="ctl-btn" data-act="pause" data-id="${esc(t.id)}" data-paused="${st.paused ? 1 : 0}" title="${st.paused ? "恢复运行" : "暂停(停止自动运行)"}">${st.paused ? "▶" : "⏸"}</button>
      <button class="ctl-btn" data-act="restart" data-id="${esc(t.id)}" title="重启">&#x21BB;</button>
    </span>` : "";
  return `<div class="card" data-id="${esc(t.id)}">
    <span class="card-tag ${t.type === "app" ? "hosted" : "link"}">${t.type === "app" ? "托管" : "链接"}</span>
    ${ctlBtns}
    <button class="info-btn" data-id="${esc(t.id)}" title="详情">&#8505;</button>
    <div class="card-icon">${esc(t.icon || "🧰")}</div>
    <div class="card-name">${esc(t.name)}</div>
    <div class="card-desc">${esc(t.desc || "")}</div>
    ${caps ? `<div class="caps">${caps}</div>` : ""}
    <div class="card-foot"><span class="card-dot ${dotCls}"></span>${stxt}</div>
    <button class="del-btn" data-id="${esc(t.id)}" data-name="${esc(t.name)}" title="删除">&#x1F5D1;</button>
  </div>`;
}
