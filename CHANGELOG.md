# CHANGELOG.md

> 版本变更记录。按版本分节,不拆分。

## v0.11.4 (2026-08-06) · 填 zip 链接导入(Release 资产直连创建)

- `POST /api/tools/import`:`url` 以 `.zip` 结尾 → 自动走链接导入:下载 → 解压 → 从 `tool.json` 自动创建/更新工具(与拖 zip 上传同链路),同一 id 再导=覆盖升级
- 下载支持 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量(CONNECT 隧道 + TLS);兼容代理把响应包成 multipart 的解包
- 前端「Git 导入」提示改:"仓库地址 **或 Release 的 .zip 链接**"
- **名称放宽**:Git 模式(仓库或 .zip 链接)名称可留空——后端本就从 URL/tool.json 推导 id 与名称,不再强制前端填写;保存按钮/名称框标注"可留空从 zip 自动识别"
- 场景:工具 Release 附平台版 zip 资产 → 粘贴资产链接即自动托管,零输入

## v0.11.3 (2026-08-06) · 零输入 zip 上传(纯 zip 自动创建工具)

### 新能力

- **纯 zip 上传即创建工具**:`POST /api/files` 不带 `path` 字段时,平台自动解压 zip → 从 zip 内 `tool.json` / `manifest.json`(顶层或单层子目录)读取配置 → 校验 → 创建/更新 `tools/<id>/` → 自动启动
  - 同一 id 再次上传 = 覆盖更新(升级工具);无需先填名称、无需指定 path
  - 前端「+ 添加」支持:不填任何字段,直接拖入带 tool.json 的 zip 即可(零输入)
- 新增 `lib/core/upload.js#findManifest()`(zip 解压目录内定位声明文件)

### 使用

```
网页「+ 添加」→ 直接把 zip 拖进弹窗 → 平台自动创建并启动
curl -F "file=@tool.zip" http://<host>/api/files
```

### 配套

- `docs/使用指南.md` 第四节标注零输入上传;积分仪表盘部署包(zip 内已预填 wb-sync.json)上传后零配置可用

## v0.11.2 (2026-08-06) · 清理功能根因修复(删了又出现)

### 根因(核心 bug)

- `cleanupDisk`(存储管理清理)与 `removeTool`(删除工具)对"删除失败"的处理**语义相反**:
  - `removeTool` 失败 → `markRemoved`(保留标记,下次扫描跳过)
  - `cleanupDisk` 失败 → `restoreTool`(清除标记,下次扫描**又识别回来**)
- 后果:挂载点/占用目录删除失败后,平台把标记清掉,幽灵目录反复出现("删了又出现"),用户被迫手动清数据

### 修复(语义统一)

- `cleanupDisk` 删除失败 → **保留 removed 标记 + 返回具体错误**(与 removeTool 一致);EBUSY/EPERM 转为可操作提示「目录被占用或为 Docker 挂载点,需在宿主机处理(删除挂载源或改 compose)」
- 删除成功 → 彻底清 removed/paused 记录(行为不变)
- 前端清理结果:失败项**逐个列出目录+原因**(不再笼统"已转解除托管")
- `scanDisk` 新增 `mount` 字段(st_dev 设备号检测挂载点),挂载点幽灵提示「需在宿主机处理」
  - 注:Windows Docker Desktop 的 bind mount 在容器内 st_dev 相同,故 EBUSY 错误码兜底识别挂载点(全平台有效)

### 验证

- 测试 52 → 55(删除失败保留标记 / 幂等清理 / 挂载点不误报)
- Docker 容器实测嵌套挂载场景(wb-credits 式独立挂载):清理返回明确提示,再次扫描 ghost → removed,不再反复识别

## v0.11.1 (2026-08-05) · 密码交互修复 + 备份删除 + 版本号

### 修复

- **密码智能弹窗**:顶栏「密码」打开时探测密码状态,自动切换模式——
  - 无密码 → 「设置管理员密码」,输入**两次新密码**(一致才生效),不再要求旧密码
  - 有密码 → 「修改管理员密码」,旧密码 + 新密码(留空新密码 = 清除)
- **备份支持删除**:`DELETE /api/tools/backup`(toolbackup.js 加 deleteToolBackup,文件名安全校验防穿越,幂等删除);备份弹窗每条新增「删除」按钮
- 测试 50 → 52(备份删除 2 用例)

### 新增

- **底部版本号**:首页底部 fixed 显示 `Tools Center vX.Y.Z`(读 `GET /api/version` 镜像内 package.json),**更新成功与否一眼可辨**

### 验证

- 52/52 测试全过 + 密码全流程端到端(无密码设置/修改/旧密码拒绝/清除)实测通过

## v0.11.0 (2026-08-05) · 存储管理 + 生命周期控制 + 全局模块化重构

### 新增功能

- **内置「存储管理」工具**(顶栏「存储」按钮):列出 `tools/` 目录**所有**内容并分类——托管中 / 无效配置 / 已解除托管 / 幽灵目录(无 manifest)
  - 每项都有复选框可**批量清理**(需管理员密码),托管中工具先停进程再删
  - 已解除托管/无效配置可一键**恢复托管**;右侧状态词(运行中/已暂停/不可用/残留/幽灵)+ 分类说明图例
  - 后端 `lib/core/disk-ops.js`(scanDisk/cleanupDisk/cleanWithStop)+ `lib/routes/disk.js`;防路径穿越
- **工具暂停/恢复**:暂停 = 停止进程且**不再自动拉起**(持久化 `data/paused-tools.json`),恢复 = 重新运行
  - 卡片左上角 ⏸/▶ + ↻ 快捷按钮;详情弹窗同样可操作;卡片状态显示「⏸ 已暂停」
- **卡片交互优化**:点击卡片**直接打开工具**(不再弹详情);详情弹窗改为左下角 ⓘ 按钮触发
- **添加工具防重复**:保存按钮提交锁(连点不会创建多个副本)
- **密码可选**:设置密码可为空(= 无密码状态,空密码删除 admin-pass.json);初次登录不强制设置;修改可覆盖
- **幽灵删除兜底**:前端有卡片、后端查无此人的"幽灵工具"——删除前探测接口判定,确认弹窗明示「残留卡片」;后端幂等删除(ghost:true 标记)

### 重构(模块化)

- **抽 `lib/core/lifecycle.js`**:removedSet/pausedSet 状态管理独立(不依赖 registry,避免循环依赖);restoreTool 只清标记,扫描由调用方负责
- **拆 `lib/routes/tools.js`(189 行)→ 4 域**:`tools-proxy`(反代) / `tools-crud`(增删查+导入+校验) / `tools-files`(日志+上传) / `tools-prefix`(单工具控制)
- **拆前端 `public/js/ui.js`(294 行)→ 4 文件**:`ui.js`(基础/能力) + `cards.js`(渲染) + `detail.js`(详情弹层) + `disk.js`(存储管理)
- **registry.js 瘦身**:327 → 256 行,只保留注册表核心

### 测试与基建

- **补 manager/proxy 单元测试**(各 6 用例):进程托管(启动/停止/暂停联动/无效跳过) + 反代(link 302/404/500/__BASE__ 注入/上游 502)
- **测试总数 38 → 50**;全模块语法检查 32 → 39 文件
- **修测试基建**:Windows 下 `node --test` 并发子进程偶发 DLL 初始化失败 → 串行(`--test-concurrency=1`)+ 显式文件列表
- **Dockerfile**:apt 源换清华镜像(容器内构建提速,官方源国内 8 分钟下不完 → 9.7s);移除冗余 `VOLUME` 声明(避免匿名卷挂载风险)

### 验证

- 50/50 测试全过 + 39 文件语法全过 + 端到端(列表/存储清理/暂停恢复/反代/日志/幽灵删除/磁盘清理)全部通过

## v0.10.1 (2026-08-04) · 路由按域拆分(前瞻性模块化)

- **server.mjs 瘦身**:456 行 → 48 行(启动序列 + createServer + upgrade + listen)
- **lib/routes/ 按域拆分**:
  - `helpers.js`:sendJson/jsonBody/publicTool/refreshTools/serveIndex 共享工具
  - `tools.js`(工具/反代/日志/上传) + `backup.js`(备份恢复) + `webdav.js` + `admin.js`(密码) + `cap.js`(能力+静态)
  - `index.js`:合并各域路由 + matchRoute;顺序敏感段处理(backup 的 /api/tools/backup* 先于 tools 通配前缀)
- **死代码清理**:移除从未引用的 MIME 表
- 验证:29 测试全过 + 全域 API 冒烟(6 域全 OK)+ 真实容器 e2e(反代/备份/前端正常)

## v0.10.0 (2026-08-04) · 工具级备份/恢复

- **lib/core/zip.js**:零依赖 zip 打包/解包(Node 内置 zlib.crc32+deflateRaw),多目录合并打包、CRC 校验、防 zip-slip 路径穿越
- **lib/core/toolbackup.js**:工具级备份(`tools/<id>/` 代码+数据全包 → `data/backups/tools-<ts>.zip`);勾选单/多工具恢复;目标已存在自动备份为 `<id>.pre-restore-*`;重扫自动重启
- **API**:`POST/GET /api/tools/backup`(备份/列表)、`POST /api/tools/backup/restore`(恢复)、`GET /api/tools/backup/download`(下载 zip)
- **前端**:顶栏「备份」按钮 + 弹窗(立即备份/备份列表含工具勾选/恢复所选/下载);api.js 封装 `apiToolBackup`
- **文档**:docs/使用指南.md 新增「七·五 备份/恢复工具」章节
- 测试:tests/zip.test.mjs(4)+tests/toolbackup.test.mjs(5),全量 29 用例通过
- 端到端验证:备份 1MB→删除→恢复→工具重新运行+账号数据完整

## v0.9.0 (2026-08-04) · 安全边界 + 结构重构

- **目录环境变量化**:`TOOLS_DIR`/`DATA_DIR` 覆盖默认目录(部署时显式写死扫描范围),compose 三件套同步更新
- **修改密码接口**:`POST /api/admin/pass/change`(旧密码校验),前端顶栏新增「密码」入口,解决"设过一次就锁死"
- **docs/security.md**:信任模型、扫描范围锁定、root 取舍、目录自动创建、未来隔离方向
- **路由表重构**:`server.mjs` if/else 链 → `{ p/prefix/re, m, handler }` 注册表 + `matchRoute()`,行为完全一致
- **前端模块化拆分**:`index.html` 内联 JS → `public/js/{api,ui,app}.js` 三文件(零依赖保持),新增 `/js/` 静态路由(防路径穿越)
- 行为兼容:未设 env 时目录回退 `<root>/tools`、`<root>/data`(与历史一致)

## v0.8.2 (2026-08-04) · 架构文档 + 加固

- **docs/ARCHITECTURE.md**:基于当前实现的架构文档(主逻辑四条链路 + 支线辅助面 + 模块职责表 + 数据流 + API + 开发指南)
- **README 重构**:更新到 v0.8 现状,文档索引补全(ARCHITECTURE/deploy-nas/sdk/template/PLAN-V2)
- 加固:`manager.start()` cmd 防御(坏工具不中断 startAll)+ spawn 异常捕获
- 加固:日志句柄释放(`detachLog`,删除工具时回收文件流与内存缓冲)

## v0.8.1 (2026-08-04) · 遗留修复(WebSocket/测试/CI)

- **WebSocket 反代**:`proxyUpgrade()` 支持 /tool/<id>/ 升级双向转发(工具可实时推送)
- **单元测试**:tests/ 四组(node:test 零依赖)20 用例,`npm test` 运行
- **CI lint**:push 自动语法检查(后端全模块 + 前端内联 JS)
- MIME 扩展(图片/字体/文档/wasm 等 20+ 类型)
- Git 导入传 exists 回调(防覆盖已托管工具)

## v0.8.0 (2026-08-04) · 二轮审核安全修复

- **前端 XSS 修复**:工具名/描述/图标/分组全量转义;delTool 改 data 属性事件委托
- **zip 炸弹防护**:解压后校验体积增量(>500MB 中止)
- browser daemon:连接重置清 sessions、/cmd 请求体上限 1MB

## v0.7.0 (2026-08-04) · V2 内核重构(M0-M5 完成)

### 架构
- **三层结构**:`lib/core/`(内核 12 模块) + `lib/capabilities/`(能力层) + `server.mjs`(入口薄层)
- **声明式接入**:manifest.json(V1 tool.json 自动映射),runtime/capabilities/entry 声明
- **能力懒加载**:idle→starting→running→回收 状态机,600s 空闲回收

### 能力模块
- **browser**:浏览器桥平台化(CDP 代理,dev 真实 Edge / headless Chromium 双后端)
- **storage**:数据目录(CAP_STORAGE_DIR)+ 平台级 WebDAV 备份/恢复

### 功能
- Git 仓库导入工具(浅克隆+自动识别 manifest)
- manifest 在线校验 API
- 门户 UI v2:能力徽标 / 详情弹层(日志/重启) / 能力筛选 Tab / 能力健康指示器
- 模板项目 templates/tool-template + 工具 SDK lib/sdk.js

### 重构清理
- 解分层倒置(webdav 提升到内核层)、server.mjs 瘦身、能力名单单一来源、死代码清理

## v0.6.1 (2026-08-04) · 集成 wb-credits v1.3.3

- 镜像构建时 clone 的 wb-credits 升级到 **v1.3.3**(确认弹窗修复/WebDAV 下载恢复/自动刷新免闪屏/计算收敛到后端)
- 上传 zip 后自动 `scanTools + restart` 生效(v0.6.0 已含)

## v0.6.0 (2026-08-03) · UI 重构(App Store 风格)

### 界面重构
- **全新首页**:大图标卡片网格(App Store 风格),深色主题
- **顶栏置顶**:Logo + 统计 + 刷新/添加入口,滚动不消失
- **分类标签**:顶部横向滑动标签按分组筛选,工具多时自动生成
- **手机适配**:小屏固定 3 列大卡片,描述自动隐藏,触控友好
- 卡片悬停高亮,异常工具红框标识,删除按钮悬停浮现

### 功能增强
- **zip 上传跨平台解压**:Windows 用 PowerShell Expand-Archive,Linux 用 unzip(Docker 预装)
- 上传 path 支持目录写法(`tools/<id>/` 自动拼接文件名)
- 删除 zip 失败不再阻塞响应(只读卷 zip 残留无害)
- 首次设置管理员密码(单输入框,至少 4 位)

### 修复
- 分类名含特殊字符导致 onclick 失效(改用 dataset)
- multipart 上传到目录路径时 EISDIR 报错

## v0.5.0 (2026-08-03) · 上传增强 + CI 构建

### 新增
- **通用文件上传** `POST /api/files`:支持 multipart 和 JSON 两种模式,路径限定在 tools/data 目录
- **zip 自动解压**:上传 .zip 包自动 `unzip` 到目标目录后删除压缩包
- **GitHub Actions CI**:推 main 自动构建 Docker 镜像推送到 `ghcr.io/simiely/tools-center`
- Docker 镜像预装 `unzip` + 预置 `wb-credits` 积分工具(构建时 clone)

### 变更
- `docker-compose.yml` 指向 ghcr.io 远程镜像(不再依赖本地 build)
- 文档:README 补 Docker 拉取说明,使用指南补 `/api/files` 接口 + zip 上传说明

## v0.4.7 (2026-08-03) · 子路径 301 规范化
## v0.4.7 (2026-08-03) · /tool/<id> 无尾斜杠 301 规范化

**修复:从首页卡片打开工具(无尾斜杠)后 JS/资源 404、按钮失效。**

### 变更
- `server.mjs`:`/tool/<id>`(恰好一段、无尾斜杠)→ **301 重定向**到 `/tool/<id>/`(link 型同样适用)
- 首页卡片点击直接打开带尾斜杠的 `/tool/<id>/`(双保险)
- 原因:无尾斜杠时页面内相对路径 `./app.js` 解析到 `/tool/app.js`(404);带斜杠才解析到 `/tool/<id>/app.js`
- 验证:无斜杠 301 ✓ / 带斜杠 200 ✓ / 子路径不受影响 ✓ / 无头浏览器从无斜杠进入 JS 完整渲染(hero/卡片/按钮)✓

## v0.4.6 (2026-08-03) · 反代自动注入 __BASE__(子路径挂载修复)

**解决:带页面的工具挂载到 /tool/<id>/ 后 JS/API 全 404(按钮无效)。**

### 变更
- `lib/proxy.js`:app 型工具 **HTML 响应自动注入** `<script>window.__BASE__="/tool/<id>"></script>`(仅 text/html,重算 content-length,去 content-encoding;API/非 HTML 不受影响)
- 工具页面 JS 用 `__BASE__ + "/api/.."` 访问自己的接口 → 子路径下一切正常
- 使用指南新增「子路径挂载约定」:资源用相对路径、API 用 `__BASE__` 前缀(附错误/正确对照表)

### 验证
- 积分仪表盘挂载:`/tool/wb-credits-tool/` 注入成功;无头浏览器实测 hero 28623、6 卡片、刷新按钮就绪、无报错;8080 独立运行不受影响

## v0.4.5 (2026-08-03) · 放目录即出工具 + 规范文档

**接入方式收敛为两条:放目录(核心)/ 网页在线添加。确定不做 handler 型(零端口挂载)。**

### 变更
- `GET /api/tools` 改为**访问即自动重扫 `tools/` 目录 + 增量同步**:放好目录+`tool.json` 后刷新页面,新工具自动出现并启动;删目录刷新即消失(复用 manager.sync 增量逻辑,幂等安全)
- 清理 registry.js 中 handler 型半成品(validate/scanTools/createTool 恢复纯 app/link 双类型),保持代码干净
- 首页 meta 提示"把工具目录放进 tools/ 后点刷新即自动发现"
- **docs/使用指南.md 重写为规范版**:目录结构规范(核心)、tool.json 字段速查与校验规则、**API 参考完整清单**、放目录/网页两种接入、更新/删除、NAS 部署、FAQ

### 验证
- 放目录 → 刷新 → 自动发现 + `running + health ok`;反代通;删目录(平台 API)→ 自动消失 + 子进程停止 + 端口释放

## v0.4.4 (2026-08-03) · 整目录上传

**多文件/子目录的工具(如积分仪表盘的 lib/)也能网页一键接入。**

### 新增
- 「📂 选择文件夹」按钮(`webkitdirectory`):整目录上传,**保留子目录结构**(如 `lib/accounts.js`)
- 后端 upload 支持子路径:自动建目录 + 路径安全校验(规范化后必须仍在工具目录内,防逃逸)

### 验证(通过)
- 上传 `lib/accounts.js` → 子目录自动创建 ✓;`../escape.mjs` 被拒 ✓

## v0.4.3 (2026-08-03) · 创建时直接传文件

**添加工具一步到位:填名称 → 选代码文件 → 保存,创建与上传合并。**

### 变更
- 「＋ 添加工具」弹窗 app 型内新增「📁 选择文件」(可多选),保存时**创建 + 上传 + 启动**一气呵成
- 卡片 ⬆ 上传按钮保留(后续补传文件用)

### 验证(端到端通过)
- 创建(极简)→ 上传 `server.mjs` → 重启 → 反代验证上传代码生效 → 删除;全程 API 串行,与前端弹窗逻辑一致

## v0.4.2 (2026-08-03) · 网页上传代码

**"填名字 → 上传自己的代码"完整闭环,全程网页操作,不碰服务器文件系统。**

### 新增
- 卡片 **⬆ 上传** 按钮:选择本地代码文件(多选)→ `POST /api/tools/<id>/upload` 写入工具目录 → 自动重启生效
- 后端上传接口:`{name, content}` JSON 写入 `tools/<id>/`;**路径逃逸防护**(`../`、`/` 均拒绝)

### 验证(通过)
- 极简创建 → 上传 `main.mjs` → 目录落盘 → 重启生效;`../../evil.mjs` 被拒 ✓

## v0.4.1 (2026-08-03) · 添加工具极简化

**添加工具从"填 10 个字段"降到"填 1 个名称",全自动。**

### 新增
- **极简创建**:网页「＋ 添加工具」只填名称即可保存——后端自动生成 id、自动分配空闲端口、**自动生成可运行示例代码**(`server.mjs`)、自动写 `tool.json`、立即启动
- 弹窗重构:必填仅"名称"(link 型加地址);id/描述/分组/图标/命令/端口/健康检查全部收进**「▸ 高级设置」折叠**
- 后端 `createTool` 增强:app 型未指定端口→自动分配;目录为空且未给 cmd→生成示例并默认 `["node","server.mjs",<port>]`

### 验证(通过)
- 只填 `{name}` 创建 app → id/端口 8100/示例 server.mjs/cmd 全自动 → running → 反代可访问
- 只填 `{name,url}` 创建 link → 自动 id ✓;删除测试工具正常

## v0.4.0 (2026-08-03) · 自助接入 + Docker 化

**程序完整化:用户可以自己在线添加/删除工具,并可容器化部署。**

### 新增
- **工具管理 API**:`POST /api/tools`(在线创建,校验+建目录+写 tool.json+启用)、`DELETE /api/tools/<id>`(停进程+删目录)
- **首页在线添加**:「＋ 添加工具」弹窗表单(app/link 切换、字段、实时 tool.json 预览、保存即启用);卡片 🗑 删除按钮(confirm)
- **Docker 化**:`Dockerfile`(node:22-slim,USER node)、`docker-compose.yml`(8080、tools/data 挂载卷、TZ)、`.dockerignore`
- **接入指南** [`docs/使用指南.md`](docs/使用指南.md):app/link 两种接入、在线添加/手动文件、字段速查、NAS 部署、常见问题

### 修复
- **进程状态与配置解耦**:manager 运行时状态改存内部 `run` Map,不再写 `ToolSpec`(`scanTools` 重建 spec 不再丢状态——此前出现"进程在跑但状态显示 stopped")
- **删除运行中工具 EBUSY**:Windows 下子进程占用目录导致 rmdir 失败 → DELETE 先 `manager.stop` 再删
- `manager.stop` 导出缺失

### 验证(全通过)
- 在线创建 app/link → 首页出现 → 放代码 → restart → running+ok → 删除成功
- 重复创建/非法 id 正确报错;创建删除后其他工具状态稳定(running 不丢)
- wb-credits 全程 running + health ok;反代正常

## v0.3.0 (2026-08-03) · M2 接入积分仪表盘

**第一个真实工具接入,平台跑通完整闭环。**

### 新增
- `tools/wb-credits/`:接入 `workbuddy-credits-tool`(积分仪表盘),`tool.json` 声明为 `app` 型(端口 8123,健康检查 `/api/status`)
- 账号池/历史/缓存数据随副本带入(6 个账号,工具中心内即可刷新/看明细/看趋势)

### 变更
- 移除 M1 测试工具 `fake-tool`(为真实工具让出 8123 端口);保留 `link-demo` 作为 link 型示例

### 验证(M2 验收通过)
- 首页出现"积分仪表盘"卡片(监控分组)✓
- `/tool/wb-credits` 反代正常:页面渲染 ✓、`/api/status` ✓、`/api/all` 返回 **6 账号真实数据** ✓
- 工具日志被工具中心聚合(启动日志可见)✓
- edge-daemon(添加账号辅助)初期手动启,M5 计划 `sidecars` 纳入托管

## v0.2.0 (2026-08-03) · M1 平台骨架

**工具中心可运行:扫描注册表 → 托管子进程 → 统一入口。**

### 新增
- `lib/` 五模块:
  - `config.js`:常量集中(端口/端口段/超时/退避/日志保留)
  - `registry.js`:扫描 `tools/*/tool.json` → 注册表;校验 id/type/url/cmd/port、端口段、**端口冲突检测**
  - `manager.js`:进程托管(app 型)——spawn、崩溃**指数退避自动拉起**(1s→30s,连败 5 次停)、优雅停止(SIGTERM→5s→SIGKILL)、健康检查轮询
  - `proxy.js`:零依赖反向代理(`/tool/<id>/*`,流式透传,60s 超时);link 型 **302 跳转**
  - `logger.js`:子进程 stdout/stderr → 文件(按天滚动,保留 7 天)+ 内存 200 行
- `server.mjs` 入口:路由分发(首页 / `/tool/*` / `/api/tools` / `/api/reload` / `/api/logs` / restart)
- `public/index.html` 首页:分组卡片网格、状态点(健康/异常)、托管/链接标记、30s 轮询
- `package.json`(ESM 零依赖)+ 测试夹具 `test/fixtures/`(fake-tool / link-demo)

### 修复
- 子进程 `cmd[0]==="node"` 时用中心自身的 `process.execPath`(避免依赖 PATH 导致 ENOENT 反复重启)

### 验证(M1 验收全通过)
- 注册表:app/link 双类型、端口冲突标记无效工具 ✓
- 托管:fake-tool `running + health ok` ✓;**杀掉进程 2.5s 内自动拉回** ✓
- 反代 `/tool/fake-tool/*` ✓;link 302 ✓;404 ✓;日志聚合 ✓;首页渲染 ✓

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
