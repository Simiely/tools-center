# CHANGELOG.md

> 版本变更记录。按版本分节,不拆分。

## v0.1.0 (2026-08-03) · 规划阶段

**首版,建立项目基础。**

### 新增
- 仓库初始化:`Simiely/tools-center`(public)
- 单项目规范文档 4 件套:README / AGENTS / DEVELOPMENT / CHANGELOG + `rules/`
- `DESIGN.md`:完整架构设计
  - 模块化 `lib/` 五模块(registry / manager / proxy / logger / config)
  - `tool.json` 声明规范(`type: app | link`)
  - Docker 化方案(Dockerfile + compose + 群晖部署要点)
  - 安全考虑(内网 + 可选 token + Tailscale)
- `PLAN.md`:完整路线图
  - 里程碑 M0~M5(M0 已完成,其余待开发)
  - 首批工具矩阵(积分仪表盘 / 微信读书服务化 / link 导航)
  - 任务分解、风险、验收标准
- `.gitignore`:排除 `data/`、工具凭证、日志

### 调研结论(支撑规划)
- 微信读书官方 Agent 网关可用(`POST i.weread.qq.com/api/agent/gateway` + `Bearer wrk-xxx`)→ 扩展可服务化且零依赖
- 群晖 Container Manager 部署要点:PUID/PGID、TZ、数据卷惯例、restart 策略

### 规划
- **M1 平台骨架**(下一里程碑):lib 五模块 + 首页 + tool.json 扫描(含 link 型)
- M2 接入积分仪表盘 → M3 微信读书服务化 → M4 NAS 部署上线 → M5 增强
