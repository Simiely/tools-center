# AGENTS.md · 项目规则

> 给 AI 与"未来的你"看的精简规则。核心约束尽量短,细节放 `rules/` 按需 @引用。

## 技术栈

- Node.js ≥ 18(开发 22.x),**纯原生 ESM,零第三方依赖铁律**(`node:http` / `node:child_process` / fetch)
- 前端:原生 HTML/CSS/JS,无框架;深色粉红主题 `#ff9292`(与积分仪表盘视觉一致)
- 部署:单容器(Dockerfile node:22-slim),工具以子进程托管在同一容器内

## 关键坑(摘要,详情见 @rules/常见坑.md)

1. **工具接入契约**:一切以 `tool.json` 为准;`type: app` 才 spawn 托管,`type: link` 只做卡片跳转(302),不托管
2. **端口规划**:主程序 8080,工具段 8100~8199;启动时校验冲突,冲突工具标记 error 跳过
3. **崩溃拉起必须退避**:指数退避 1s→30s 封顶,连续失败标记 error,防"崩溃风暴"
4. **数据全在挂载卷**:`tools/`、`data/` 必须挂载,容器无状态(升级镜像不丢凭证/Key)
5. NAS 部署记得 `PUID/PGID` + `TZ=Asia/Shanghai`(否则容器 root 写卷会 EACCES 权限错)

## 约定

- **零依赖是不可违反的铁律**;业务逻辑进 `lib/`,入口只做组装
- 注释、UI、文档全部中文;模块命名英文
- 平台与工具**解耦**:工具代码在各自仓库,部署时拷入挂载卷;平台不感知工具内部实现
- gitignore 注释必须独立成行(行尾 `#` 不生效,会把注释并入 pattern)

## 常用命令

```bash
# 启动(开发)
node server.mjs                 # http://127.0.0.1:8080

# 自测:用一个假工具验证托管(app)+ 一个 link 验证跳转
mkdir -p tools/demo && cp -r test/fixtures/* tools/demo/

# 语法校验(改动后必跑)
node --check server.mjs && for f in lib/*.js; do node --check "$f"; done

# API 快速验证
curl http://127.0.0.1:8080/api/tools
curl -X POST http://127.0.0.1:8080/api/reload
```

## 详细规则(按需 @引用)

- @rules/技术栈.md  @rules/常见坑.md
