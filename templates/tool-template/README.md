# 工具模板 (tool-template)

最小可运行的 app 型工具，用于快速接入 Tools Center 平台。

## 结构

```
tool-template/
├── manifest.json   # 工具声明(平台读取:runtime/capabilities/entry/port/health)
└── server.mjs      # 入口代码(平台以 node server.mjs <port> 托管)
```

## 使用方法

**方式 A：网页添加（推荐）**
1. 首页 →「+ 添加工具」→ 选择「托管进程」
2. 把本目录打成 zip 上传（或直接下载 zip）
3. 保存后平台自动分配端口、托管运行

**方式 B：Git 导入**
```bash
# 把模板 fork 到自己的仓库,修改后:
curl -X POST http://localhost:8080/api/tools/import \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/you/my-tool.git"}'
```

**方式 C：直接放目录**
```bash
cp -r templates/tool-template tools/my-tool/
# 改 manifest.json 里的 id/name/port,重启平台或 POST /api/reload
```

## manifest.json 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 工具标识，`[a-z0-9-]`，全平台唯一 |
| `name` | ✅ | 显示名称 |
| `type` | — | `app`(托管,默认) / `link`(跳转) |
| `runtime` | ✅ | `node` / `python` / `deno` / `bun` |
| `capabilities` | — | 声明需要的环境能力：`browser`(浏览器桥) / `storage`(数据目录) / `network` |
| `entry` | ✅ | 入口文件（相对 manifest 所在目录） |
| `port` | app 必填 | 工具监听端口（8100-8199） |
| `health` | — | 健康检查路径，如 `/health` |
| `cmd` | 可选 | 自定义启动命令（覆盖默认 `runtime entry port`） |

## 能力注入（平台自动写入环境变量）

| 变量 | 能力 | 说明 |
|---|---|---|
| `CAP_STORAGE_DIR` | storage | 本工具专属数据目录（持久化、随平台备份） |
| `CAP_BROWSER_BASE` | browser | 浏览器桥基址（SDK `capBrowser()` 自动获取） |
| `CAP_ENSURE_EP` | 全部 | 能力懒加载触发端点 |

## 注意

- 数据写 `CAP_STORAGE_DIR`，**不要**写在工具代码目录里（代码目录可能被更新覆盖）
- 端口由平台托管，代码里用 `process.argv[2]` 读取（不要写死）
- 更多能力用法见 `docs/capabilities/browser.md` 与 `docs/sdk.md`
