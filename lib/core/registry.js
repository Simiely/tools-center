// lib/registry.js - 工具注册表:扫描 tools/*/tool.json → Map<id, ToolSpec>
// 区分 app(托管:监听端口+平台反代)/ link(跳转);校验字段、类型、端口段与端口冲突。
import fs from "node:fs";
import path from "node:path";
import { CONFIG, DIRS } from "./config.js";
import { loadManifest, normalizeManifest } from "./manifest.js";
import { capabilityEnv, checkCapabilities } from "./capability.js";

let map = new Map();   // id -> ToolSpec
let byPort = new Map(); // port -> id(app 型,冲突检测)

/** 读取 JSON,失败返回 null(容错:非法 tool.json 标记为无效工具而非崩溃) */
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** 字段校验,返回错误数组(空 = 通过) */
export function validate(spec) {
  const errs = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["需要 tool.json/manifest 内容(JSON 对象)"];
  if (!/^[a-z0-9-]+$/.test(spec.id || "")) errs.push("id 需为 [a-z0-9-]");
  if (!spec.name || !String(spec.name).trim()) errs.push("缺少 name");
  const type = spec.type === "link" ? "link" : "app";
  if (type === "link") {
    if (!spec.url) errs.push("link 型需 url(http(s)://)");
  } else {
    const hasCmd = Array.isArray(spec.cmd) && spec.cmd.length;
    if (!hasCmd) {
      // 入口由 cmd 或 runtime+entry 提供;归一化后 spec 的 entry 恒为 null(cmd 已生成),因此只在无 cmd 时检查
      if (!(spec.runtime && spec.entry)) errs.push("app 型需 cmd(命令数组) 或 runtime+entry");
    }
    const p = spec.port;
    if (!Number.isInteger(p) || p < CONFIG.TOOL_PORT_MIN || p > CONFIG.TOOL_PORT_MAX) {
      errs.push(`port 需在 ${CONFIG.TOOL_PORT_MIN}-${CONFIG.TOOL_PORT_MAX} 之间`);
    }
    // V2 manifest 字段(runtime/entry 二者其一,或 cmd)
    if (spec.entry && !spec.runtime) errs.push("有 entry 但缺 runtime");
    if (spec.runtime && !["node", "python", "deno", "bun"].includes(spec.runtime)) {
      errs.push(`runtime 仅支持 node/python/deno/bun(当前: ${spec.runtime})`);
    }
  }
  // capabilities 检查(声明了但平台没有 → 提示)
  if (Array.isArray(spec.capabilities) && spec.capabilities.length) {
    const missing = checkCapabilities(spec);
    for (const m of missing) errs.push(`能力未注册: ${m}(可用: browser/storage/network)`);
  }
  return errs;
}

/** 在线校验:返回 { ok, errors, normalized }(normalized = V1→V2 归一化视图,不写盘) */
export function validateManifest(raw) {
  const errors = validate(raw);
  const ok = errors.length === 0;
  let normalized = null;
  if (ok) {
    const norm = normalizeManifest(raw, "validate");
    normalized = {
      id: norm.id, name: norm.name, type: norm.type, port: norm.port,
      capabilities: norm.capabilities, runtime: norm.runtime, entry: norm.entry, cmd: norm.cmd,
    };
  }
  return { ok, errors, normalized };
}

/**
 * 扫描 tools/ 目录,重建注册表。
 * @returns {Map<string, object>} id -> ToolSpec
 */
export function scanTools() {
  const found = new Map();
  const ports = new Map();
  if (fs.existsSync(DIRS.tools)) {
    for (const name of fs.readdirSync(DIRS.tools)) {
      const dir = path.join(DIRS.tools, name);
      let isDir = false;
      try { isDir = fs.statSync(dir).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      const m = loadManifest(dir, name);
      if (!m) continue;
      const spec = {
        id: m.id,
        name: m.name,
        desc: m.desc,
        group: m.group,
        icon: m.icon,
        type: m.type,
        url: m.type === "link" ? m.linkUrl : "",
        cmd: m.cmd,
        cwd: m.cwd,
        port: m.port,
        health: m.health,
        env: { ...m.env, ...capabilityEnv(m) },   // manifest env + 能力注入
        restart: m.restart,
        hidden: m.hidden,
        // V2 附加
        runtime: m.runtime,
        capabilities: m.capabilities,
        unknownCaps: m.unknownCaps || [],
        dir,
        valid: true,
        error: "",
        state: { status: "stopped", health: "unknown", error: "" },
      };
      const errs = validate(spec);
      const miss = checkCapabilities(m);
      if (miss.length) errs.push("缺少能力: " + miss.join(","));
      if (errs.length) {
        spec.valid = false;
        spec.error = errs.join("; ");
      } else if (spec.type === "app") {
        if (ports.has(spec.port)) {
          spec.valid = false;
          spec.error = `端口 ${spec.port} 与 ${ports.get(spec.port)} 冲突`;
        } else {
          ports.set(spec.port, spec.id);
        }
      }
      found.set(spec.id, spec);
    }
  }
  map = found;
  byPort = ports;
  return map;
}

// 自动生成的最小可运行示例(app 型在线添加的起点;用户可覆盖成自己的工具)
const EXAMPLE_SERVER = `// 自动生成的示例工具(可替换成你的代码)
// 规则:监听 127.0.0.1:<端口>,提供一个 /health 健康检查。
import http from "node:http";

const port = parseInt(process.argv[2] || "8100", 10);

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, path: req.url, time: new Date().toISOString() }));
}).listen(port, "127.0.0.1", () => {
  console.log("example tool listening on :" + port);
});
`;


export function getTool(id) { return map.get(id) || null; }
export function listTools() { return [...map.values()]; }
export function getByPort(port) { return byPort.get(port) || null; }

/** 在线创建工具:建目录 + 写 tool.json → 重扫。spec = tool.json 内容(缺失字段自动补全) */
export function createTool(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("需要 tool.json 内容(JSON 对象)");
  const type = spec.type === "link" ? "link" : "app";
  if (!spec.name || !String(spec.name).trim()) throw new Error("缺少 name(工具名称)");
  let id = String(spec.id || "");
  if (!id) id = "tool-" + Date.now().toString(36); // 未指定时自动生成
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("id 需为 [a-z0-9-]");
  if (map.has(id)) throw new Error("工具已存在: " + id);
  const dir = path.join(DIRS.tools, id);
  if (fs.existsSync(dir)) throw new Error("目录已存在(冲突): " + dir);
  // 自动分配端口(app 型未指定时,取端口段最小空闲)
  if (type === "app" && !spec.port) {
    for (let p = CONFIG.TOOL_PORT_MIN; p <= CONFIG.TOOL_PORT_MAX; p++) {
      if (!byPort.has(p)) { spec.port = p; break; }
    }
    if (!spec.port) throw new Error("工具端口段(" + CONFIG.TOOL_PORT_MIN + "-" + CONFIG.TOOL_PORT_MAX + ")已满");
  }
  fs.mkdirSync(dir, { recursive: true });
  // 自动生成最小可运行示例(app 型且目录为空、未给 cmd)→ 用户保存后立即能跑,再替换成自己的代码
  if (type === "app" && fs.readdirSync(dir).length === 0 && !spec.cmd) {
    fs.writeFileSync(path.join(dir, "server.mjs"), EXAMPLE_SERVER, "utf8");
    spec.cmd = ["node", "server.mjs", String(spec.port)];
  }
  fs.writeFileSync(path.join(dir, "tool.json"), JSON.stringify(spec, null, 2), "utf8");
  scanTools();
  const t = map.get(id);
  if (!t || !t.valid) throw new Error("配置无效: " + (t ? t.error : "未知"));
  return t;
}

/** 在线删除工具:删目录(含 tool.json)→ 重扫 */
export function removeTool(id) {
  const t = map.get(id);
  if (!t) throw new Error("工具不存在: " + id);
  fs.rmSync(t.dir, { recursive: true, force: true });
  scanTools();
  return true;
}

