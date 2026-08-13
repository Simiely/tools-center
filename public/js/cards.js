// public/js/cards.js - 工具列表渲染(分组/分类过滤/卡片 HTML + UI 排序应用)
// 依赖: ui.js(esc, capLabel)
// v0.13.1:uiOrder(分组顺序/组内卡片顺序)由 dnd.js 维护,渲染时应用;渲染后 bindDnd 挂拖拽。
let tools = [], activeCat = "all", activeCap = "";
let uiOrder = { groupOrder: [], toolOrder: {} }; // 拖拽排序持久化(api/ui-order)

/** 组内按 uiOrder.toolOrder 排序;未记录的工具保持原顺序排后 */
function sortByOrder(arr, orderedIds) {
  const idx = new Map(orderedIds.map((id, i) => [id, i]));
  return [...arr].sort((a, b) => {
    const ia = idx.has(a.id) ? idx.get(a.id) : 1e9;
    const ib = idx.has(b.id) ? idx.get(b.id) : 1e9;
    return ia - ib;
  });
}

function renderTabs() {
  const cats = [...new Set(tools.map(t => t.group || "工具"))];
  const caps = [...new Set(tools.flatMap(t => t.capabilities || []))];
  // 单分类自动隐藏分类 tab(2026-08-06):所有工具同属一个分类时只留「全部」,避免"全部+唯一分类"冗余;≥2 个分类才显示
  const showCats = cats.filter(c => c !== "全部").length > 1;
  if (!showCats && activeCat !== "all") { activeCat = "all"; renderCards(); }
  // 单能力自动隐藏能力 tab(2026-08-08):能力是"环境需求"不是"业务分类",只有 1 个能力时顶部不展示,避免"全部+💾"冗余;
  // 工具卡片/详情的能力徽标(cap-chip)不受影响,仍照常显示
  const showCaps = caps.length > 1;
  if (!showCaps && activeCap) { activeCap = ""; renderCards(); }
  // 分类 tab 跟随拖拽后的分组顺序(v0.13.1):与卡片分组渲染同源(uiOrder.groupOrder)
  const groupIdx = new Map(uiOrder.groupOrder.map((g, i) => [g, i]));
  const orderedCats = cats.filter(c => c !== "全部").sort((a, b) => {
    const ia = groupIdx.has(a) ? groupIdx.get(a) : 1e9;
    const ib = groupIdx.has(b) ? groupIdx.get(b) : 1e9;
    return (ia - ib) || a.localeCompare(b);
  });
  $("tabs").querySelector(".tabs-inner").innerHTML =
    `<button class="tab ${activeCat === "all" && !activeCap ? "on" : ""}" data-cat="all" data-cap="" onclick="setCat('all','')">全部</button>` +
    (showCaps ? caps.map(c => `<button class="tab ${activeCap === c ? "on" : ""}" data-cap="${esc(c)}" onclick="setCat('', this.dataset.cap)">${esc(capLabel(c))}</button>`).join("") : "") +
    (showCats ? orderedCats.map(c => `<button class="tab ${activeCat === c ? "on" : ""}" data-cat="${esc(c)}" onclick="setCat(this.dataset.cat,'')">${esc(c)}</button>`).join("") : "");
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
  // 保留 groupOrder 记录的空组(v0.13.1:跨组拖走最后一张卡后组变空,刷新后仍显示虚线占位可拖回;
  // 仅在未筛选时补充——分类/能力筛选下空组无工具归属,不显示)
  if (!activeCat && !activeCap) {
    for (const g of uiOrder.groupOrder) if (!(g in groups)) groups[g] = [];
  }
  // 应用 UI 排序(v0.13.1):组按 groupOrder,组内按 toolOrder;未记录的新组/新工具自动排后
  const groupIdx = new Map(uiOrder.groupOrder.map((g, i) => [g, i]));
  const groupNames = Object.keys(groups).sort((a, b) => {
    const ia = groupIdx.has(a) ? groupIdx.get(a) : 1e9;
    const ib = groupIdx.has(b) ? groupIdx.get(b) : 1e9;
    return (ia - ib) || a.localeCompare(b);
  });
  $("main").innerHTML = groupNames.map((g) =>
    `<div class="sec" data-group="${esc(g)}"><div class="sec-title" data-group="${esc(g)}" title="拖动排序分组">${esc(g)} <span class="count">${groups[g].length}</span></div><div class="grid">${sortByOrder(groups[g], uiOrder.toolOrder[g] || []).map(cardHtml).join("")}</div></div>`
  ).join("");
  if (typeof bindDnd === "function") bindDnd(); // 渲染后挂拖拽(dnd.js)
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
    <div class="card-icon">${iconHtml(t.icon)}</div>
    <div class="card-name">${esc(t.name)}</div>
    <div class="card-desc">${esc(t.desc || "")}</div>
    ${caps ? `<div class="caps">${caps}</div>` : ""}
    <div class="card-foot"><span class="card-dot ${dotCls}"></span>${stxt}</div>
    <button class="del-btn" data-id="${esc(t.id)}" data-name="${esc(t.name)}" title="删除">&#x1F5D1;</button>
  </div>`;
}
