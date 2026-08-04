# 工具 SDK 文档 (lib/sdk.js)

平台内置的工具开发封装。工具代码里 `import` 平台提供的 `lib/sdk.js`（工具运行于平台容器内，可直接引用相对路径），或拷贝函数体自用。

## 快速开始

```js
// 工具入口 server.mjs
import { capBrowser, capStorageDir, toolId } from "../../lib/sdk.js";

const storageDir = capStorageDir();      // CAP_STORAGE_DIR,工具数据目录
const browser = await capBrowser();      // 懒加载获取浏览器桥客户端
const status = await browser.status();   // { connected, backend, ... }
```

## API

### `capStorageDir()`
返回工具专属数据目录（`CAP_STORAGE_DIR` 环境变量）。**所有持久化数据写这里**——平台备份/恢复、WebDAV 同步都以它为边界。

```js
import fs from "node:fs";
import path from "node:path";
import { capStorageDir } from "../../lib/sdk.js";
const dir = capStorageDir();
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({...}));
```

### `capBrowser()` → BrowserClient
懒加载浏览器桥。首次调用触发平台启动浏览器能力（真实 Edge / headless Chromium），返回客户端对象。无平台注入时（独立运行）自动直连本地 `8129`（edge-daemon 兼容）。

```js
import { capBrowser } from "../../lib/sdk.js";
const b = await capBrowser();
const tabs = await b.tabs();                 // 列出标签页
const html = await b.eval(tabId, "document.body.innerText"); // 执行 JS
const ok = await b.cmd(tabId, "Page.reload"); // CDP 命令
```

**客户端方法**（与 edge-daemon API 契约一致）：

| 方法 | 说明 |
|---|---|
| `status()` | `{ connected, backend, port }` |
| `tabs()` | 标签页列表（`targetId` / `url` / `title`） |
| `eval(targetId, expr)` | 在页面执行 JS，返回结果 |
| `cmd(targetId, method, params?)` | 发送 CDP 命令 |
| `newtab(url)` | 打开新标签页 |

> 需要浏览器能力的工具，在 manifest.json 声明：`"capabilities": ["browser"]`

### `toolId()`
返回当前工具 id（`manifest.id`）。

## 能力懒加载机制

```
工具启动        → 平台只注入 env（CAP_BROWSER_BASE 为空占位），不拉起浏览器
工具首次调用    → capBrowser() 内部 POST {CAP_ENSURE_EP}/api/capabilities/browser/ensure
                  → 平台启动浏览器能力（idle → running）→ 返回真实基址
空闲 600s      → 平台自动回收（running → recycling → idle）
```

对工具无感：`capBrowser()` 内部处理 ensure + 重试，工具代码只写业务逻辑。

## 平台 API（工具内可调用）

工具进程运行于平台内，可访问平台管理 API（`CAP_ENSURE_EP` 为主机地址）：

| 端点 | 用途 |
|---|---|
| `GET /api/capabilities` | 能力状态列表 |
| `POST /api/capabilities/<name>/ensure` | 懒加载触发 |
| `GET /api/tools` | 工具列表 |
| `POST /api/backup` | 立即备份 |

## 独立运行降级

工具脱离平台单独 `node server.mjs` 运行时：
- `capStorageDir()` → 返回 `cwd/.data`（fallback）
- `capBrowser()` → 直连 `http://127.0.0.1:8129`（edge-daemon），平台不存在也不崩溃

一套代码，平台托管与独立运行双模式。
