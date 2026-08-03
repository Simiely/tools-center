// test fixture:假工具(fake-tool)— 极简 HTTP 服务,验证框架托管/反代/健康/日志
import http from "node:http";

const port = parseInt(process.argv[2] || "8123", 10);

http.createServer((req, res) => {
  const body = JSON.stringify({ ok: true, tool: "fake-tool", path: req.url, time: new Date().toISOString() });
  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ status: "up" }));
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}).listen(port, "127.0.0.1", () => {
  console.log(`fake-tool listening on :${port}`);
});
