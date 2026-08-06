// lib/core/modules.js - 附加模块注册表(单一事实来源,2026-08-06 v0.11.8)
// 微内核"插件注册表":一处声明模块清单,settings(开关)与 routes(挂载)都引用。
// 新增一个附加模块 = 在这里加一项 + 提供 routes + 前端入口(见 docs/架构梳理.md「新增附加模块」)。
// 主干框架(registry/manager/proxy/logger 等)不属于本表,恒注册不可关。

export const MODULES = [
  { key: "storage", name: "存储管理", desc: "大弹窗:程序/数据分列、清理、残留回收", defaultOn: true },
  { key: "backup", name: "备份", desc: "工具全量备份 zip 与平台数据备份(可还原)", defaultOn: true },
  { key: "webdav", name: "WebDAV 云同步", desc: "备份上传/下载到 WebDAV", defaultOn: true },
  { key: "auth", name: "管理密码", desc: "密码设置与修改;关闭后所有管理操作免密码", defaultOn: true },
  { key: "capabilities", name: "能力模块", desc: "工具可选能力(browser 浏览器 / storage 存储)", defaultOn: true },
  { key: "import", name: "在线导入", desc: "拖 zip / Git 仓库 / Release zip 链接导入工具", defaultOn: true },
];

/** key → 默认开关 */
export const MODULE_DEFAULTS = Object.fromEntries(MODULES.map((m) => [m.key, m.defaultOn]));

/** key → 展示信息(设置页渲染用) */
export const MODULE_INFO = Object.fromEntries(MODULES.map((m) => [m.key, { name: m.name, desc: m.desc }]));

/** 合法模块 key 集合(校验传入的开关) */
export const MODULE_KEYS = MODULES.map((m) => m.key);
