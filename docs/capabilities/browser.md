# 能力模块 · browser（浏览器桥）

> 平台提供的浏览器环境能力。工具声明 `"capabilities":["browser"]` 后，经 SDK/API 契约使用，不关心底层浏览器实现。

## 能力模型

| 项 | 值 |
|---|---|
| 能力名 | `browser` |
| 懒加载 | 是——工具首次调用才启动（`POST /api/capabilities/browser/ensure`），空闲 600s 回收 |
| HTTP 端口 | 能力端口段 8200-8299（首个模块固定 8200） |
| 状态 | `idle` / `starting` / `running` / `recycling` / `error` |

## API 契约（能力 HTTP 服务）

```
GET  /status               -> { connected, port, backend }
GET  /tabs                 -> [{index, targetId, title, url}]
GET  /eval?target=0&expr=JS -> Runtime.evaluate 结果（自动 attach 页面）
POST /cmd {method,params,targetId?} -> 任意 CDP 命令（targetId 自动 attach）
GET  /newtab?url=...       -> 新开标签页
```

兼容原 edge-daemon 契约：credits-tool 等旧客户端无需改动。

## 双后端（backend）

| 后端 | 触发 | 说明 |
|---|---|---|
| `dev`（默认） | 环境变量未设置或 `EDGE_BROWSER_BACKEND=dev` | 连接真实 Edge（`--remote-debugging-port=9222`，非默认 user-data-dir） |
| `headless` | `EDGE_BROWSER_BACKEND=headless` | 容器/NAS：spawn headless Chromium 并连接 |

浏览器不可用时：`connected:false`，周期重试，**不崩溃**。工具健康不受影响，仅浏览器相关功能降级（如"添加账号"不可用）。

## 工具接入方式

1. `manifest.json` 声明：`"capabilities": ["browser"]`
2. 工具内用 SDK（或按契约直连）：

```js
import { capBrowser } from "<platform>/lib/sdk.js"; // 或工具内实现同逻辑客户端

const b = await capBrowser();        // 首次调用自动 ensure（懒加载）
const s = await b.status();          // { connected, port, backend }
const tabs = await b.tabs();         // 页面列表
const r = await b.cmd("Network.getAllCookies", {}, tab.targetId); // 读 cookie 等
```

SDK 内部：读 `CAP_ENSURE_EP`（平台注入）→ `POST .../browser/ensure` → 拿 `base` → 直连能力 API。

## 注入环境（工具进程）

| 变量 | 说明 |
|---|---|
| `CAP_ENSURE_EP` | 平台能力 ensure 端点（懒加载触发用） |
| `CAP_BROWSER_BASE` | 浏览器桥 API 基址（ensure 后由 SDK 获取，启动前为空） |

## 安全边界（演进中）

- 浏览器桥只对声明 `browser` 能力的工具开放（装配器校验，未知能力报错）
- 凭证仍存工具各自数据目录（M2 storage 能力）
- 后续：host 白名单 → 凭证加密（见 PLAN-V2-DETAIL 演进路线）
