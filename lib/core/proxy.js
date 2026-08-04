// lib/proxy.js - 反向代理(仅 app 型)+ link 型 302 跳转
// 零依赖:node:http 转发,流式透传,60s 超时;WebSocket 升级留待 M5。
import http from "node:http";
import { CONFIG } from "./config.js";
import { getTool } from "./registry.js";

/**
 * 处理 /tool/<id>[/rest...] 请求。
 * @returns {boolean} true = 已处理(含 404),false = 不该由本层处理
 */
export function proxyRequest(req, res, url) {
  const seg = url.pathname.split("/"); // ["", "tool", id, ...rest]
  if (seg.length < 3 || seg[1] !== "tool") return false;
  const id = decodeURIComponent(seg[2]);
  const tool = getTool(id);
  if (!tool) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "tool not found: " + id }));
    return true;
  }
  if (tool.type === "link") {
    const rest = seg.slice(3).join("/");
    const to = tool.url + (rest ? "/" + rest : "") + (url.search || "");
    res.writeHead(302, { Location: to });
    res.end();
    return true;
  }
  if (!tool.valid) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "tool 配置无效: " + tool.error }));
    return true;
  }
  const restPath = seg.slice(3).join("/");
  const target = new URL(restPath + (url.search || ""), `http://127.0.0.1:${tool.port}/`);
  const pr = http.request(
    {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: tool.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${tool.port}` },
    },
    (prs) => {
      // HTML 响应注入 __BASE__:工具在 /tool/<id>/ 子路径下挂载,JS 可用 __BASE__ + "/api/.." 访问自己的接口
      const ct = String(prs.headers["content-type"] || "");
      if (ct.includes("text/html")) {
        const buf = [];
        prs.on("data", (c) => buf.push(c));
        prs.on("end", () => {
          let html = Buffer.concat(buf).toString("utf8");
          const inj = `<script>window.__BASE__=${JSON.stringify("/tool/" + id)};</script>`;
          html = html.includes("</head>") ? html.replace("</head>", inj + "</head>") : inj + html;
          const headers = { ...prs.headers, "content-length": Buffer.byteLength(html) };
          delete headers["content-encoding"];
          res.writeHead(prs.statusCode, headers);
          res.end(html);
        });
        return;
      }
      res.writeHead(prs.statusCode, prs.headers);
      prs.pipe(res);
    }
  );
  pr.setTimeout(CONFIG.PROXY_TIMEOUT_MS, () => pr.destroy(new Error("proxy timeout")));
  pr.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "上游不可达(工具未运行?)" }));
    } else {
      res.end();
    }
  });
  req.pipe(pr);
  return true;
}
