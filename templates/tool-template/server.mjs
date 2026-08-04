// 工具模板示例:最小可运行的 app 型工具。
// 启动后由 tools-center 平台托管(进程/日志/健康/反代),manifest.json 声明能力。
// 端口从进程参数传入(平台按 manifest.port 托管),也可用 process.env 读取能力注入。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = parseInt(process.argv[2] || process.env.PORT || "8150", 10);

// 能力注入(由平台装配器写入):
//   CAP_STORAGE_DIR  → storage 能力:本工具专属数据目录(持久化,随备份)
//   CAP_ENSURE_EP    → 能力懒加载触发端点(SDK capBrowser() 内部使用)
const storageDir = process.env.CAP_STORAGE_DIR || path.join(process.cwd(), ".data");

const server = http.createServer(async (req, res) => {
  const out = { ok: true, name: "my-tool", storageDir: storageDir || null };
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    // 数据读写示例:用 storage 能力目录,不写工具代码目录
    if (req.url === "/note" && req.method === "POST") {
      let body = "";
      for await (const c of req) body += c;
      fs.mkdirSync(storageDir, { recursive: true });
      fs.writeFileSync(path.join(storageDir, "note.txt"), body.slice(0, 1000));
      out.saved = true;
    } else if (req.url === "/note") {
      const f = path.join(storageDir, "note.txt");
      out.note = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    }
  } catch (e) {
    out.error = e.message;
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(out, null, 2));
});

server.listen(port, "127.0.0.1", () => console.log(`my-tool running on ${port}`));
