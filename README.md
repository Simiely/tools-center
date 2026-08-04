# Tools Center · 轻量工具统一宿主

把你写的各种轻量小工具(积分仪表盘、购书工作台、脚本服务…)以 **"放目录 + 写 `tool.json`"** 的方式统一挂载到一个入口,统一托管进程,常驻在你的 NAS 上。

> **当前状态:可用(App Store 风格 UI + 分类标签 + 手机适配 + Docker CI,v0.6.x)**。详见 [`CHANGELOG.md`](CHANGELOG.md)。

## 功能目标

- 统一入口:一个地址进首页,`/tool/<id>` 直达各工具
- 现代界面:置顶导航 + 分类标签筛选 + 大图标卡片(手机 3 列适配)
- 进程托管:崩溃自动拉起 / 健康检查 / 日志聚合
- 极简添加:**放目录 + 写 `tool.json` → 刷新页面即自动出现**(或网页「+ 添加」填名称/拖拽 zip)
- 安全:删除工具需管理员密码(首次访问设置)
- 两种类型:`app`(托管子进程)/ `link`(纯导航卡片,跳转外部服务)
- 轻量到底:Node 零依赖、单容器、低资源占用

## 快速开始

```bash
# 开发环境
node server.mjs                # http://127.0.0.1:8080

# Docker(从 GitHub Container Registry 拉取)
docker pull ghcr.io/simiely/tools-center:main
docker compose up -d           # http://localhost:8080
```

**添加工具**(3 种方式):
- 网页:首页「+ 添加」→ 填名称 → 保存(可拖拽上传 **zip 包自动解压**)
- 手动:`tools/<id>/` 放目录 + 写 `tool.json` → 刷新
- API:`POST /api/files` 上传文件到 `tools/` 或 `data/` 目录

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

> **独立性原则**：各工具保持独立仓库、独立部署（独立容器/进程），tools-center 只做统一入口。
> `app` 型 = 工具代码独立挂载到 `tools/<id>/`（代码不入仓库、独立更新）；`link` 型 = 工具独立运行，这里只放一张跳转卡片。

| 工具 | 接入方式 | 说明 |
|---|---|---|
| 积分仪表盘 | link | [workbuddy-credits-tool](https://github.com/Simiely/workbuddy-credits-tool) 独立部署后，加一张卡片跳转 |
| 微信读书购书工作台 | app | weread-budget-extension 服务化(待建) |
| NAS 现有服务(Jellyfin 等) | link | 一张卡片接入 |

