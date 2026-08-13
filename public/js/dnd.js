// public/js/dnd.js - 首页分组/卡片拖拽排序(v0.13.1 → SortableJS 引擎)
// 引擎:public/js/vendor/sortable.min.js(v1.15.7,MIT,vendor 单文件豁免零依赖铁律——无 npm/无构建)。
// 为什么换引擎:原生 HTML5 DnD 拖图不跟手、无平滑让位动画、无触屏支持;SortableJS 用
// forceFallback 自绘拖图 + FLIP 动画 + touch 支持,体验完整。
// 结构:
//   - #main 组 sortable:draggable=.sec, handle=.sec-title(拖标题换组顺序)
//   - 每个 .grid 卡片 sortable:group 共享 tools(组内排序 + 跨组拖)
// 数据:拖后读 DOM 顺序 → uiOrder(内存)→ 防抖 POST /api/ui-order 持久化;
//       跨组拖 = 额外 POST /api/tools/meta 改工具分组(写回 tool.json)。
// 关键约束:拖后【不 load()】——避免 GET /api/ui-order 旧数据覆盖本地(POST 未发出)。
// 依赖: cards.js(tools/uiOrder/renderTabs/renderCards), api.js(apiToolMeta/apiUiOrder/toast)。

let _saveTimer = null;
const sortables = []; // 当前页面所有 Sortable 实例(重渲染前 destroy)

/** 渲染后调用:为 #main(组)与每个 .grid(卡片)创建 Sortable(renderCards 末尾自动触发) */
function bindDnd() {
  // 销毁旧实例(renderCards 重建 DOM 后,旧实例引用的节点已不存在)
  for (const s of sortables) { try { s.destroy(); } catch {} }
  sortables.length = 0;

  const mainEl = document.getElementById("main");
  if (mainEl) {
    sortables.push(Sortable.create(mainEl, {
      draggable: ".sec",
      handle: ".sec-title",
      animation: 100, // 让位动画快一些,减少"慢半拍"感
      ghostClass: "s-ghost",
      chosenClass: "s-chosen",
      forceFallback: true, // 方案B:被拖元素本体跟手(半透明缩小+阴影,见 .s-fallback 样式),原位留 ghost 占位
      fallbackClass: "s-fallback",
      fallbackOnBody: true,
      onEnd: () => {
        const groups = [...mainEl.querySelectorAll(":scope > .sec")].map((s) => s.dataset.group);
        if (!groups.length) return;
        uiOrder.groupOrder = groups;
        saveUiOrderDebounced();
        renderTabs(); // tab 顺序跟随组顺序
      },
    }));
  }

  document.querySelectorAll("#main .grid").forEach((grid) => {
    sortables.push(Sortable.create(grid, {
      draggable: ".card",
      group: "tools", // 共享 group:允许跨组拖入/拖出
      animation: 100,
      ghostClass: "s-ghost",
      chosenClass: "s-chosen",
      forceFallback: true,
      fallbackClass: "s-fallback",
      fallbackOnBody: true,
      // 同组内排序:重建该组 toolOrder
      onUpdate: (evt) => {
        const group = evt.to.closest(".sec").dataset.group;
        syncToolOrder(group);
        saveUiOrderDebounced();
      },
      // 跨组拖入:改工具分组(写回 tool.json)+ 迁移顺序
      onAdd: async (evt) => {
        const id = evt.item.dataset.id;
        const toGroup = evt.to.closest(".sec").dataset.group;
        const fromGroup = evt.from.closest(".sec").dataset.group;
        try {
          await apiToolMeta.update(id, { group: toGroup });
        } catch (err) {
          toast("移动失败: " + err.message);
          load(); // 回滚(重拉后端,恢复 DOM)
          return;
        }
        const memTool = tools.find((x) => x.id === id);
        if (memTool) memTool.group = toGroup;
        if (fromGroup) syncToolOrder(fromGroup); // 来源组重建顺序(该卡已移出)
        syncToolOrder(toGroup);                  // 目标组重建顺序
        saveUiOrderNow();
        renderTabs(); // tab 分类可能增减
      },
    }));
  });
}

/** 按某组当前 DOM 顺序重建 uiOrder.toolOrder[group] */
function syncToolOrder(group) {
  const grid = document.querySelector(`#main .sec[data-group="${CSS.escape(group)}"] .grid`);
  if (!grid) return;
  const ids = [...grid.querySelectorAll(":scope > .card")].map((c) => c.dataset.id);
  if (ids.length) uiOrder.toolOrder[group] = ids;
  else delete uiOrder.toolOrder[group];
}

/* ---- 自动保存(防抖 500ms) ---- */
function saveUiOrderDebounced() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveUiOrderNow, 500);
}
function saveUiOrderNow() {
  clearTimeout(_saveTimer);
  apiUiOrder.save(uiOrder).catch((e) => toast("顺序保存失败: " + e.message));
}
