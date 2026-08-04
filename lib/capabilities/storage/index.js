// lib/capabilities/storage/index.js - 存储能力模块
// 提供:工具数据目录(CAP_STORAGE_DIR) + 平台级 WebDAV 备份/恢复。
// 无独立进程(目录能力由装配器直接注入),懒加载基座用于状态管理(常驻与否无资源差异)。
import path from "node:path";
import { DIRS } from "../../core/config.js";
import { createCapabilityBase } from "../index.js";

const base = createCapabilityBase("storage", {
  async start() { /* 目录能力:无进程,无需启动 */ },
  stop() { /* 无进程 */ },
});

/** 数据根目录(所有工具数据) */
base.base = () => DIRS.data;
/** 单工具数据目录 */
base.toolDir = (toolId) => path.join(DIRS.data, "tools", toolId);

export const storageCap = base;
