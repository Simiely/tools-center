# Tools Center 安全边界

本文档说明平台的**信任模型**与**权限边界**：平台能扫描什么、工具进程能访问什么、root 运行的取舍，以及未来的隔离方向。

---

## 1. 信任模型（最重要）

> **工具 = 你信任的代码。**

平台的设计目标是托管**你自己写的、你自己 clone 的工具**，因此信任边界建立在"工具都是自己的"之上，而**不是**强制沙箱。

- 平台**不做**文件系统沙箱（无 chroot / seccomp / cgroups）
- 工具进程是平台 spawn 的普通子进程，`cwd` 只是初始工作目录，**不是隔离边界**
- 因此：**只安装你信任的工具**。来源不明的工具不要装进平台

---

## 2. 扫描范围（已锁定）

平台的"识别/扫描"范围是**严格限定**的：

| 项目 | 现状 |
|---|---|
| 扫描目录 | 仅 `DIRS.tools`（容器内 = `/app/tools`） |
| 扫描深度 | 单层（`readdirSync` 只列一级子目录，不递归） |
| 识别条件 | 目录 + `tool.json`（manifest），其余忽略 |
| 扫描入口 | 代码里仅此一处（`lib/core/registry.js: scanTools`） |

代码**不存在**"扫描全盘"的路径——它不是"能扫全盘但克制"，而是**根本没有扫其他目录的代码**。想让它扫别处必须改代码。

### 部署时显式写死（v0.9+）

`lib/core/config.js` 支持环境变量覆盖目录：

```js
export const DIRS = {
  tools: process.env.TOOLS_DIR ? path.resolve(process.env.TOOLS_DIR) : path.join(ROOT, "tools"),
  data:  process.env.DATA_DIR  ? path.resolve(process.env.DATA_DIR)  : path.join(ROOT, "data"),
};
```

compose 里写死（**必须与 volumes 挂载目标一致**）：

```yaml
environment:
  - TOOLS_DIR=/app/tools
  - DATA_DIR=/app/data
```

效果：扫描范围在部署配置上**显式可见**，双层确认"只扫这一个目录"。

---

## 3. 工具进程的运行时权限（当前偏大，已知）

| 层面 | 隔离情况 |
|---|---|
| 识别/发现 | ✅ 限定 tools 目录 |
| 端口段 | ✅ 工具端口强制 8100-8199（registry 校验） |
| 进程工作目录 | ✅ 初始 cwd = 工具目录 |
| 文件系统 | ❌ 无沙箱；若容器 `user: root` 运行，可读容器内一切 |
| 网络 | ❌ 无限制（容器网络内全通） |

**与扫描的区别**：平台扫描是锁死的；但**工具代码**运行时的访问能力是宽松的。这是两件不同的事。

---

## 4. root 运行的取舍

镜像默认 `USER node`（UID 1000，非 root）。compose 里显式 `user: root` 是**为了挂载卷写权限**：

- Docker bind mount 的宿主目录若由引擎自动创建（`create_host_path`），属主为 **root**
- 容器内 `node` 用户（UID 1000）写不进 root 属主的挂载卷 → 保存密码/日志/工具数据都会失败
- 家庭内网部署用 `root` 运行最简单可靠

### 非 root 替代方案

```yaml
user: "1000:1000"
```

```bash
# 部署前执行一次，把挂载目录属主改为 UID 1000
chown -R 1000:1000 /mnt/usb2/Configs/tools-center /mnt/usb2/Configs/workbuddy-credits-tool
```

注意：chown 后 NAS 上其他账号直接编辑这些目录也会无权限，需自行权衡。

> 安全上：root 与否对"工具能否读容器内文件"影响不大（容器内路径非 root 也基本可读）。真正的风险点是工具代码本身，靠信任模型控制。

---

## 5. 目录自动创建行为

| 目录 | 自动创建？ | 说明 |
|---|---|---|
| `tools` / `data`（挂载卷） | ✅ Docker 自动建 | bind mount 宿主路径不存在时引擎自动创建（`create_host_path` 默认开启） |
| `data/logs` 等子目录 | ✅ 代码兜底 | `auth.js` 等用 `fs.mkdirSync(..., { recursive: true })` |
| `wb-credits`（独立仓库） | ❌ **必须手动 clone** | Docker 只会建空目录，**不会拉 git 代码**；先 `git clone` 再挂载 |

---

## 6. 未来隔离方向（未实现，仅记录）

当需要托管**来源不明或相互不信任**的工具时，按成本递增：

1. **能力强制拦截**：`capabilities`（browser/storage/network）目前只是声明，未做强制；可改为工具进程权限校验
2. **工具级容器隔离**：每个工具独立容器，只挂自己目录、只开自己端口，平台经网络访问——真正的沙箱
3. **只读挂载 + 独立数据卷**：工具目录只读挂载，写操作全部走平台能力层（storage）中转

当前阶段（个人工具宿主、工具都是自己的），上述项**无需实施**，保持文档记录即可。

---

## 7. 管理员密码

- 存储：`data/admin-pass.json`，sha256 摘要，**不落明文**
- 首次访问：未设置密码时弹窗引导设置（`POST /api/admin/pass`）
- 修改：`POST /api/admin/pass/change`（需旧密码，前端顶栏「密码」入口，v0.9+）
- 遗忘：无找回机制，删除 `data/admin-pass.json` 后重启容器可重新设置
