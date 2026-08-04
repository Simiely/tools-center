# Tools Center · 轻量工具统一宿主

把你写的各种轻量小工具(积分仪表盘、购书工作台、脚本服务…)以 **"放目录 + 写 `manifest.json`"** 的方式统一挂载到一个入口,统一托管进程,常驻在你的 NAS 上。

> **当前状态:v0.8.x(V2 内核)**——统一运行时 + 可插拔能力模块 + 声明式工具插件。详见 [`CHANGELOG.md`](CHANGELOG.md) 与 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 核心特性

- **统一入口**:一个地址进首页,`/tool/<id>` 直达各工具(HTTP 反代 + WebSocket 升级)
- **声明式接入**:工具只写 `manifest.json` 声明需求(运行时/能力/入口),平台负责装配环境
- **能力模块(可插拔)**:`browser`(浏览器桥,Edge/headless 双后端)/ `storage`(数据目录+备份)/ `network`,懒加载按需启动、空闲 600s 回收
- **进程托管**:崩溃自动拉起(退避 1s→30s)/ 健康检查 / 日志聚合(滚动+内存缓冲)
- **三种添加方式**:网页表单 / zip 上传(自动解压+炸弹防护) / Git 仓库导入
- **数据安全**:内置本地备份 + WebDAV 云同步;管理员密码保护敏感操作
- **轻量到底**:Node 零依赖内核、单容器、低资源占用;本机/Docker/NAS 三模式

## 快速开始

```bash
# 开发环境
node server.mjs                # http://127.0.0.1:8080

# Docker
docker compose up -d           # http://localhost:2626
```

**添加工具**(3 种方式):
- 网页:首页「+ 添加」→ 三种模式(托管进程 + zip / 外部跳转 / Git 导入)
- 手动:`tools/<id>/` 放目录 + 写 `manifest.json`(或 V1 `tool.json`) → 刷新
- Git:粘贴仓库地址,自动识别 manifest 并托管

## 文档索引

| 文档 | 给谁看 | 内容 |
|---|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 开发者 | **当前架构主线**:主逻辑四条链路 + 支线辅助面 + 模块职责表 + 数据流 + API |
| [`docs/security.md`](docs/security.md) | 部署者/开发者 | **安全边界**:信任模型、扫描范围、root 取舍、隔离方向 |
| [`docs/使用指南.md`](docs/使用指南.md) | 用户 | **接入你的小工具**(app/link、在线添加、字段速查) |
| [`docs/deploy-nas.md`](docs/deploy-nas.md) | 部署者 | **部署指南**(群晖/iStoreOS/Windows/Docker) + 故障排查 |
| [`docker-compose.nas.example.yml`](docker-compose.nas.example.yml) | 部署者 | **NAS 完整部署配置模板**(隐私路径 `/path/to/xxxx` 占位,复制替换即用) |
| [`docs/sdk.md`](docs/sdk.md) | 工具作者 | **工具 SDK**(capBrowser/capStorageDir/懒加载机制) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 所有人 | **未来规划**:AI 能力接入(DeepSeek)、工具隔离、测试补强等已确认方向 |
| [`templates/tool-template/`](templates/tool-template/) | 工具作者 | **最小可运行模板**(manifest + server.mjs + README) |
| [`AGENTS.md`](AGENTS.md) | AI / 未来的你 | 技术栈、关键坑、约定、常用命令 |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | 开发者 | 项目概览、历史架构说明 |
| [`CHANGELOG.md`](CHANGELOG.md) | 所有人 | 版本变更记录 |
| [`PLAN-V2.md`](PLAN-V2.md) | 所有人 | **V2 重构规划**(已完成) |

## 接入的工具

> **独立性原则**:各工具保持独立仓库、独立部署,tools-center 只做统一入口(挂载代码 / link 跳转)。

| 工具 | 接入方式 | 说明 |
|---|---|---|
| 积分仪表盘 | app | [workbuddy-credits-tool](https://github.com/Simiely/workbuddy-credits-tool) 独立仓库挂载,平台托管进程 |
| 微信读书购书工作台 | app | weread-budget 服务化(本地开发中) |
| NAS 现有服务(Jellyfin 等) | link | 一张卡片接入 |

## 测试

```bash
npm test          # 单元测试(node:test,零依赖)
npm run check     # 全模块语法检查
```

## 技术栈

Node.js 22+ 零依赖 · 单文件门户 UI · Docker Compose · GitHub Actions(自动构建+lint)
