# 拖拽排序方案 · SortableJS 接入全记录

> 场景:首页工具卡片按分组展示,需要「组间排序 + 组内排序 + 跨组拖=改分组」,且顺序自动保存。
> 本文记录方案选型、接入要点、跟手调试踩坑——**可直接复用到其他需要拖拽排序的项目**。

## 1. 为什么不用原生 HTML5 DnD

第一版用浏览器原生 `draggable` 实现(零依赖),三个硬伤无法绕过:

| 痛点 | 原因 |
|---|---|
| 拖图不跟手 | 浏览器生成的半透明缩略图跟随有延迟、偏移,Edge/Firefox 样式不一致,无法精细定制 |
| 无平滑让位动画 | HTML5 DnD 只有"插到目标前后",元素不会"滑开让位",僵硬 |
| 无触屏支持 | 手机/平板完全不能拖 |

**结论:成熟拖拽库(如 SortableJS)本质是自己用 Pointer/Mouse 事件模拟拖拽 + FLIP 动画,绕开 HTML5 DnD 全部缺陷。**

## 2. 选型:SortableJS(单文件 vendored)

| 维度 | 说明 |
|---|---|
| 体积 | `Sortable.min.js` 45KB(gzip ~15KB),**自身零依赖** |
| 能力 | 组间/组内/跨组(group 配置)+ FLIP 让位动画 + 触屏 + 自动滚动,全内置 |
| 接入 | 一个 `<script>` 全局 `Sortable`,无 npm/无构建 |
| 维护 | 40K+ star,持续维护 |

**对"零第三方依赖"铁律的处理**:新增 `public/js/vendor/` 目录豁免——只允许放**零依赖单文件**第三方库,文件头部注释标注来源/版本/许可证。核心逻辑仍零依赖。

下载(v1.15.7, MIT):
```bash
mkdir -p public/js/vendor
curl -L -o public/js/vendor/sortable.min.js \
  "https://cdn.jsdelivr.net/npm/sortablejs@1.15.7/Sortable.min.js"
```

## 3. 接入要点(核心代码)

两个 Sortable 实例:一个管**组**(`#main > .sec`, handle 为标题),一个管**每个组内卡片**(`.grid > .card`, 共享 group 允许跨组)。

```js
// 组排序:只允许拖 .sec-title,不拖整块(否则卡内文字/按钮误触)
Sortable.create(mainEl, {
  draggable: ".sec",
  handle: ".sec-title",
  animation: 100,
  ghostClass: "s-ghost",    // 原位占位(半透明)
  chosenClass: "s-chosen",  // 拖动中选中态
  onEnd: () => {
    uiOrder.groupOrder = [...mainEl.querySelectorAll(":scope > .sec")].map(s => s.dataset.group);
    saveUiOrderDebounced(); // 防抖 500ms 自动保存
    renderTabs();           // 顶部 tab 顺序同源
  },
});

// 卡片排序 + 跨组:group 同名 = 允许互相拖入拖出
document.querySelectorAll("#main .grid").forEach(grid => {
  Sortable.create(grid, {
    draggable: ".card",
    group: "tools",        // 共享组名 → 跨组拖动
    animation: 100,
    forceFallback: true,   // 自绘拖图(跨浏览器一致,支持触屏)
    onEnd: (evt) => {
      const { id } = evt.item.dataset;
      const from = evt.from.dataset.group, to = evt.to.dataset.group;
      if (from !== to) moveCardAcross(id, from, to); // 跨组 = 调后端改分组
      else updateOrderInGroup(to);
    },
  });
});
```

### 关键配置解释

| 配置 | 作用 | 备注 |
|---|---|---|
| `handle: ".sec-title"` | 组只从标题拖 | 防整块误拖 |
| `group: "tools"` | 同名 group 互通 | 跨组拖入/拖出 |
| `forceFallback: true` | 自绘拖图 | 不用浏览器原生 drag image,样式一致 + 触屏可用 |
| `animation: 100` | FLIP 让位动画 ms | 越小越跟手,100 平衡观感 |

## 4. 跟手调试踩坑(重点,最容易翻车)

### 坑 1:`.card` 的 `transition` 会拖慢拖图 ⚠️ 头号元凶

```css
.card { transition: .18s; }  /* 简写 = 所有属性过渡 */
```

Sortable 拖动时用 `left/top` 实时定位被拖卡片,**每次位置更新都被平滑 180ms → 拖图永远慢半拍**("不跟手"的经典症状)。修复:

```css
.card.s-fallback { transition: none !important; }
```

### 坑 2:给拖图加 `scale()` 会偏位 ⚠️

想"轻量跟手"加了 `transform: scale(.92)`,但 Sortable 用 `transform: translate()` 定位 fallback,**两者组合产生 8% 位置偏差——拖得越远偏得越多**(实测 150px 就偏 13px)。修复:**去掉 scale,保持 1:1 跟手**。

验证跟手精度(playwright,拖动中采样 fallback 中心 vs 指针):
```
移(120,40)   偏移 x=0.0 y=0.0
移(300,120)  偏移 x=0.0 y=0.0
移(-80,200)  偏移 x=0.0 y=0.0
```

### 坑 3:空组拖不进 ⚠️

空组的 `.grid` 没有内容 = **高度 0**,鼠标没有可 hover 的落点。修复:

```css
.grid:empty {
  min-height: 96px;               /* 占位区有高度可落 */
  border: 1px dashed var(--line);
  border-radius: var(--r3);
  background: var(--surface);
  place-items: center;
}
.grid:empty::after { content: "拖卡片到此处"; /* 提示 */ }
```

同时渲染时保留空组(组顺序记录在 `groupOrder` 的组,即使暂时无工具也显示)。

### 坑 4:防抖保存 vs load() 时序竞争

拖动后如果调 `load()`(重新 GET),而防抖 POST 还没发出 → 读到磁盘**旧顺序**覆盖本地新值 → "拖了弹回原位"。修复:**拖后不 load(),直接本地重渲染**(内存即最新),跨组时同步更新内存 tools 的 group。

## 5. 顺序数据设计(与工具声明解耦)

```
data/ui-order.json
{
  "groupOrder": ["监控", "工具", "服务"],
  "toolOrder": { "监控": ["wb-credits", "edge-daemon"], "工具": ["note"] }
}
```

- **不写回 tool.json**:顺序是"用户 UI 习惯",不是工具属性;写 tool.json 每次拖都改声明文件 + 触发重扫
- 渲染时:组按 `groupOrder` 排(未记录的新组排最后),组内按 `toolOrder` 排(未记录的工具保持原序)
- 删工具/新增工具:忽略失效 id,新工具自动排后,不崩
- 跨组拖 = 调 `POST /api/tools/meta {id, group}` 写回 tool.json(真实改分组),顺序数据同步迁移——保证"应用管理/分类 tab/刷新后"三处一致

## 6. 文件清单(本项目)

| 文件 | 职责 |
|---|---|
| `public/js/vendor/sortable.min.js` | 引擎(v1.15.7, MIT, 零依赖单文件) |
| `public/js/dnd.js` | 接入逻辑(~99 行:两实例 + 防抖保存 + 跨组迁移) |
| `lib/core/ui-order.js` | 后端读写/校验(64KB 上限,非法静默清洗) |
| `lib/routes/ui-order.js` | GET/POST /api/ui-order(主干免密) |
| `tests/ui-order.test.mjs` | 7 例单测 |

## 7. 快速复用指南

1. 拷 `sortable.min.js` 到项目 vendor 目录
2. 容器元素建 Sortable(组/列表分别建,共享 `group` 实现跨列表)
3. **检查目标元素的 `transition`——有就 `.s-fallback{transition:none!important}`**
4. **不要给拖图加 scale**
5. 空列表给 `min-height` 占位
6. 顺序保存走防抖,拖后本地渲染不要重新 fetch
