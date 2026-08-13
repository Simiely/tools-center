// lib/routes/ui-order.js - UI 排序偏好路由(主干,不可关)
// 2026-08-13:首页卡片分组拖拽排序的保存/读取。
// 免密说明:仅读写 UI 显示顺序(分组顺序/组内卡片顺序),低危偏好数据,非敏感写面;
// 且拖动保存为高频操作,弹密码框不可接受——与"密码只保护敏感写面"的既有原则一致。
import { sendJson, jsonBody } from "./helpers.js";
import { loadUiOrder, saveUiOrder } from "../core/ui-order.js";

export const uiOrderRoutes = [
  {
    m: "GET", p: "/api/ui-order",
    handler: (req, res) => sendJson(res, 200, { ok: true, order: loadUiOrder() }),
  },
  {
    m: "POST", p: "/api/ui-order",
    handler: async (req, res) => {
      try {
        const b = await jsonBody(req);
        const order = saveUiOrder(b.order || {});
        return sendJson(res, 200, { ok: true, order });
      } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    },
  },
];
