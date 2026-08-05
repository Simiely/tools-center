// lib/routes/tools-proxy.js - 工具反代路由:/tool/ 规范化 + 反向代理到工具进程
// 职责:① /tool/<id> 无尾斜杠 → 301 补斜杠(否则页面内相对路径 ./xxx 解析错误)
//      ② /tool/<id>/... → proxyRequest 反代到工具监听端口(含 __BASE__ 注入)
import { proxyRequest } from "../core/proxy.js";

export const toolsProxyRoutes = [
  {
    re: /^\/tool\/[^/]+$/,
    handler: (req, res, url) => { res.writeHead(301, { Location: url.pathname + "/" + (url.search || "") }); return res.end(); },
  },
  {
    re: /^\/tool(?:\/|$)/,
    handler: (req, res, url) => { proxyRequest(req, res, url); },
  },
];
