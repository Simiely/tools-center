// lib/core/ui-order.js - UI 排序偏好(分组顺序 + 组内卡片顺序)
// 2026-08-13:首页卡片分组拖拽排序的持久化。平台级 UI 偏好(非工具属性),存 data/ui-order.json,
// 不写回 tool.json(顺序是用户习惯,不是工具声明;避免拖动触发工具重扫)。
// 结构: { groupOrder: string[]组顺序, toolOrder: { 组名: string[]工具id顺序 } }
// 容错:文件损坏回退空;非法字段/非法 id 静默过滤(渲染时对不存在 id 也会忽略)。
import fs from "node:fs";
import path from "node:path";
import { DIRS } from "./config.js";

const FILE = path.join(DIRS.data, "ui-order.json");
const MAX_BYTES = 64 * 1024; // 上限 64KB(防超大数据写盘)

const ID_RE = /^[a-z0-9-]+$/;

/** 校验并规整输入(容错:非法字段丢弃,返回干净结构) */
export function normalizeUiOrder(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const groupOrder = Array.isArray(r.groupOrder)
    ? r.groupOrder.filter((g) => typeof g === "string" && g.length > 0 && g.length <= 64)
    : [];
  const toolOrder = {};
  if (r.toolOrder && typeof r.toolOrder === "object" && !Array.isArray(r.toolOrder)) {
    for (const [g, ids] of Object.entries(r.toolOrder)) {
      if (typeof g !== "string" || g.length > 64 || !Array.isArray(ids)) continue;
      const clean = ids.filter((id) => typeof id === "string" && ID_RE.test(id));
      if (clean.length) toolOrder[g] = clean;
    }
  }
  return { groupOrder, toolOrder };
}

/** 读取排序偏好;文件缺失/损坏返回空结构 */
export function loadUiOrder() {
  try {
    return normalizeUiOrder(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch {
    return { groupOrder: [], toolOrder: {} };
  }
}

/** 保存排序偏好;超限拒绝。返回规整后的结构。 */
export function saveUiOrder(order) {
  const norm = normalizeUiOrder(order);
  const buf = Buffer.from(JSON.stringify(norm));
  if (buf.length > MAX_BYTES) throw new Error("排序数据过大(>64KB)");
  fs.mkdirSync(DIRS.data, { recursive: true });
  fs.writeFileSync(FILE, buf, "utf8");
  return norm;
}
