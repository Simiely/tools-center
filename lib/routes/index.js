// lib/routes/index.js - 路由注册表:合并各域路由 + 匹配器
// 域拆分:tools-proxy(反代) / tools-crud(工具增删查) / tools-files(日志+上传+导入) / tools-prefix(单工具操作)
//         / backup(备份恢复) / webdav / admin(密码+设置) / disk(存储管理) / cap(能力+静态)
// 匹配顺序:数组顺序即优先级(精确 p > 前缀 prefix > 正则 re;长前缀/特定路径需排在通配前缀前)
// 注意:backup 的 /api/tools/backup* 精确路由必须先于 tools-prefix 的 /api/tools/ 通配前缀路由,
//      故 tools 路由拆多段:proxy/crud/files(精确/反代,先) + prefix(/api/tools/ 通配,最后)
// v0.11.7:附加模块按 settings 开关过滤(module 标识,关闭则整组路由不注册;主干无 module 恒注册)
import { getModules } from "../core/settings.js";
import { toolsProxyRoutes } from "./tools-proxy.js";
import { toolsCrudRoutes } from "./tools-crud.js";
import { toolsFilesRoutes } from "./tools-files.js";
import { backupRoutes } from "./backup.js";
import { toolsPrefixRoutes } from "./tools-prefix.js";
import { webdavRoutes } from "./webdav.js";
import { adminRoutes, settingsRoutes } from "./admin.js";
import { diskRoutes } from "./disk.js";
import { capRoutes, staticRoutes } from "./cap.js";

/** 全部路由(顺序敏感:backup 的 /api/tools/backup* 必须在 tools-prefix 的 /api/tools/ 前缀前)。
 *  每组可带 module:附加模块开关(settings.json)关闭时整组不注册;无 module 的为主干,恒注册。 */
const GROUPS = [
  { routes: toolsProxyRoutes },          // 主干:工具反代
  { routes: toolsCrudRoutes },           // 主干:工具 CRUD
  { routes: toolsFilesRoutes, module: "import" }, // 附加:文件上传/日志/在线导入(Git/zip 链接)
  { routes: backupRoutes, module: "backup" },     // 附加:备份
  { routes: toolsPrefixRoutes },         // 主干:单工具操作
  { routes: webdavRoutes, module: "webdav" },     // 附加:WebDAV 云同步
  { routes: adminRoutes, module: "auth" },        // 附加:管理密码
  { routes: settingsRoutes },            // 主干:功能开关(不可关,否则关 auth 后无法开回)
  { routes: diskRoutes, module: "storage" },      // 附加:存储管理
  { routes: capRoutes, module: "capabilities" },  // 附加:能力模块
  { routes: staticRoutes },              // 主干:版本/静态/首页/独立页
];

/** 按当前开关构建路由表(每次实时读 getModules,支持 rebuildRoutes 动态生效,v0.11.9) */
function buildRoutes() {
  const modules = getModules();
  return GROUPS.filter((g) => !g.module || modules[g.module] !== false).flatMap((g) => g.routes);
}

export let routes = buildRoutes();

/** 重建路由表(保存功能开关后调用,ESM live binding 令 server 立即用新路由,零重启,v0.11.9) */
export function rebuildRoutes() {
  routes = buildRoutes();
  return routes.length;
}

/** 当前启用的模块开关(前端入口显隐用) */
export function enabledModules() { return getModules(); }

/** 路由匹配:顺序遍历,method 未指定(任意)或相等 + p/prefix/re 命中即返回 */
export function matchRoute(url, method) {
  for (const r of routes) {
    if (r.m && r.m !== method) continue;
    if (r.p && url.pathname === r.p) return r;
    if (r.prefix && url.pathname.startsWith(r.prefix) && (!r.suffix || url.pathname.endsWith(r.suffix))) return r;
    if (r.re && r.re.test(url.pathname)) return r;
  }
  return null;
}
