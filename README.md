# Tools Center · 轻量工具统一宿主

把你写的各种轻量小工具(积分仪表盘、购书工作台、脚本服务…)以 **"放目录 + 写 `tool.json`"** 的方式统一挂载到一个入口,统一托管进程,常驻在你的 NAS 上。

> **当前状态:规划阶段**(M0 完成)。架构设计(DESIGN.md)与路线图(PLAN.md)已就绪,平台骨架待开发。

## 功能目标

- 统一入口:一个地址进首页,`/tool/<id>` 直达各工具
- 进程托管:崩溃自动拉起 / 健康检查 / 日志聚合
- 极简添加:放目录 + 写 `tool.json` → 首页自动出现,零代码改动
- 两种类型:`app`(托管子进程)/ `link`(纯导航卡片,跳转外部服务)
- 轻量到底:Node 零依赖、单容器、低资源占用

## 快速开始

> ⚠️ 尚未发布。以下为**目标形态**,平台骨架开发完成后生效。

```bash
# 1. 启动(开发环境)
node server.mjs                # 打开 http://127.0.0.1:8080

# 2. 添加一个工具(两种方式任选)
#    网页:首页右上角「＋ 添加工具」在线填写 → 自动生成 tool.json → 启用
#    手动:放目录 + 写 tool.json
mkdir -p tools/my-tool
cat > tools/my-tool/tool.json <<'EOF'
{ "id": "my-tool", "name": "我的工具", "type": "app",
  "cmd": ["node", "server.mjs", "8123"], "port": 8123 }
EOF

# 3. 重载 → 首页出现卡片
curl -X POST http://127.0.0.1:8080/api/reload
```

> 📖 **怎么接入你自己的小工具**(app 托管 / link 跳转、在线添加、字段速查、NAS 部署):
> 见 [`docs/使用指南.md`](docs/使用指南.md)

NAS 部署(群晖 Container Manager / Docker Compose)步骤见 [`DEVELOPMENT.md`](DEVELOPMENT.md)。

## 文档索引

| 文档 | 给谁看 | 内容 |
|---|---|---|
| [`AGENTS.md`](AGENTS.md) | AI / 未来的你 | 技术栈、关键坑、约定、常用命令 |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | 开发者 | 项目概览、架构说明、关键决策与方案 |
| [`CHANGELOG.md`](CHANGELOG.md) | 所有人 | 版本变更记录 |
| [`DESIGN.md`](DESIGN.md) | 开发者 | **详细架构设计**(模块/规范/部署/安全) |
| [`PLAN.md`](PLAN.md) | 所有人 | **完整路线图**(里程碑 M0~M5 / 任务分解 / 验收) |
| [`docs/使用指南.md`](docs/使用指南.md) | 用户 | **接入你的小工具**(app/link、在线添加、字段速查、NAS 部署) |

## 首批工具矩阵(规划)

| 工具 | 类型 | 来源 |
|---|---|---|
| 积分仪表盘 | app | [workbuddy-credits-tool](https://github.com/Simiely/workbuddy-credits-tool)(已有) |
| 微信读书购书工作台 | app | weread-budget-extension 服务化(待建) |
| NAS 现有服务(Jellyfin 等) | link | 一张卡片接入 |
