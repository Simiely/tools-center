# Tools Center · 未来规划(ROADMAP)

> 前瞻性规划存档:记录"已确认方向但未实施"的功能项。
> 已实现的能力见 [`ARCHITECTURE.md`](ARCHITECTURE.md) / [`CHANGELOG.md`](../CHANGELOG.md)。
> 每项含:方向、改造点、依赖前置、触发条件。**未实施前不改代码,只维护本文档。**

---

## 1. AI 能力接入(DeepSeek API) · 路线 B:做成能力模块 + 内部使用

> 状态:方向已确认,待实施(拿到 API key 后启动)

### 目标

1. **能力化**:注册平台能力 `ai`,任何工具声明 `"capabilities": ["ai"]` 即自动获得 AI 调用能力(经 SDK)
2. **内部使用**:平台前端顶栏提供「AI」对话入口,平台自身也能调用 DeepSeek

### 改造点清单(按 v0.10.1 路由域模式)

| # | 文件 | 改动 |
|---|---|---|
| 1 | `lib/capabilities/ai/index.js`(新建) | AI 能力模块:`start/stop/status`(懒加载基座);持有 API key;封装 DeepSeek OpenAI 兼容调用(`chat/completions`) |
| 2 | `lib/capabilities/index.js` | `initCapabilities()` 注册 `ai`(动态 import) |
| 3 | `lib/core/config.js` | `KNOWN_CAPABILITIES` 加 `"ai"` |
| 4 | `lib/core/capability.js` | `capabilityEnv()` 加 `CAP_AI_BASE` 注入分支 |
| 5 | `lib/sdk.js` | 加 `capAI()`: `chat(messages)` / `prompt(text)` |
| 6 | `lib/routes/ai.js`(新建) | 平台 AI 助手 API:`POST /api/ai/chat`(对话,可流式) |
| 7 | `lib/routes/index.js` | `...aiRoutes` 一行接入 |
| 8 | 前端 | 顶栏「AI」按钮 + 对话弹窗;`api.js` 加 `apiAI.chat()` |
| 9 | `tests/ai.test.mjs` | 能力注册、key 校验、(mock)对话调用 |
| 10 | 文档 | 使用指南「AI 能力」章节 + sdk.md 补 `capAI` |

### API key 管理(设计决策)

```
优先级: 环境变量 DEEPSEEK_API_KEY > data/ai-config.json(网页可配)
- 环境变量: 部署固定(推荐 Docker/NAS 场景)
- 网页配置: 存 data/ai-config.json,key 不落明文(sha256,与 admin-pass 同模式)
```

### 架构效果

```
工具 tool.json: "capabilities": ["ai"]     ← 工具侧一行
      ↓ 平台注入 env.CAP_AI_BASE
lib/sdk.js capAI().chat(messages)          ← 工具侧调用
      ↓
lib/capabilities/ai/ (懒加载, 持有 key)     ← 平台侧
      ↓
DeepSeek API (OpenAI 兼容)

平台自身: 顶栏「AI」→ POST /api/ai/chat → 同一能力
```

### 触发条件

- [ ] 拿到 DeepSeek API key
- [ ] 决定 key 配置方式(环境变量 / 网页)

---

## 2. 工具级隔离(真沙箱)

> 状态:已记录方向(见 docs/security.md 第 6 节),暂缓

- 每个工具独立容器,只挂自己目录、只开自己端口
- 触发条件:需要托管来源不明或相互不信任的工具时

---

## 3. 能力强制拦截

> 状态:已记录方向(见 docs/security.md 第 6 节),暂缓

- `capabilities`(browser/storage/network)目前只是声明,未做强制
- 改为工具进程权限校验

---

## 4. 测试补强

> 状态:待办

- `manager.js`(进程托管)专属单元测试
- `proxy.js`(反向代理)专属单元测试
- 当前这两块主要靠 e2e 验证,补单测价值高

---

## 5. 路由域再细分(仅当需要)

> 状态:按需

- `lib/routes/tools.js`(180 行,最大路由域)若继续膨胀,可拆 `tools-main.js` + `tools-files.js`
- 触发条件:工具 API 端点继续增加,单文件超过 ~250 行

---

## 实施纪律

- 本文档只记录**方向与改造点**,不锁死细节
- 实施时以当时的最新架构为准(如路由域拆分已到位,新增 API 按域加文件)
- 每完成一项:更新 CHANGELOG + 本文档标记 ✅
