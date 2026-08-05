// lib/routes/index.js - 路由注册表:合并各域路由 + 匹配器
// 域拆分:tools-proxy(反代) / tools-crud(工具增删查) / tools-files(日志+上传) / tools-prefix(单工具操作)
//         / backup(备份恢复) / webdav / admin(密码) / disk(存储管理) / cap(能力+静态)
// 匹配顺序:数组顺序即优先级(精确 p > 前缀 prefix > 正则 re;长前缀/特定路径需排在通配前缀前)
// 注意:backup 的 /api/tools/backup* 精确路由必须先于 tools-prefix 的 /api/tools/ 通配前缀路由,
//      故 tools 路由拆多段:proxy/crud/files(精确/反代,先) + prefix(/api/tools/ 通配,最后)
import { toolsProxyRoutes } from "./tools-proxy.js";
import { toolsCrudRoutes } from "./tools-crud.js";
import { toolsFilesRoutes } from "./tools-files.js";
import { backupRoutes } from "./backup.js";
import { toolsPrefixRoutes } from "./tools-prefix.js";
import { webdavRoutes } from "./webdav.js";
import { adminRoutes } from "./admin.js";
import { diskRoutes } from "./disk.js";
import { capRoutes } from "./cap.js";

/** 全部路由(顺序敏感:backup 的 /api/tools/backup* 必须在 tools-prefix 的 /api/tools/ 前缀前) */
export const routes = [
  ...toolsProxyRoutes,
  ...toolsCrudRoutes,
  ...toolsFilesRoutes,
  ...backupRoutes,
  ...toolsPrefixRoutes,
  ...webdavRoutes,
  ...adminRoutes,
  ...diskRoutes,
  ...capRoutes,
];

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
