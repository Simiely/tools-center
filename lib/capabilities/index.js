// lib/capabilities/index.js - 能力注册表
// 能力 = 平台提供给工具的"环境模块"。懒加载:工具调用时才启动,空闲回收。
// 注册表: name -> { start(), stop(), status(), healthPath? }
// 状态机: idle(未启动) -> starting -> running -> recycling -> idle
// 本文件只定义接口与注册表;具体能力实现放同目录子模块(browser/storage/network...)。

export const CAP_STATUS = { IDLE: "idle", STARTING: "starting", RUNNING: "running", RECYCLING: "recycling", ERROR: "error" };

const registry = new Map(); // name -> module

/** 注册能力模块(平台启动时调用) */
export function registerCapability(name, mod) {
  registry.set(name, mod);
}

/** 获取能力模块(未注册返回 null) */
export function getCapability(name) {
  return registry.get(name) || null;
}

/** 能力是否已注册 */
export function hasCapability(name) {
  return registry.has(name);
}

/** 全部能力及其状态视图 */
export function listCapabilities() {
  return [...registry.entries()].map(([name, mod]) => {
    const st = mod.status ? mod.status() : CAP_STATUS.IDLE;
    return { name, status: typeof st === "object" ? st.state || st.status || CAP_STATUS.IDLE : st, error: typeof st === "object" ? (st.error || "") : (mod.lastError || "") };
  });
}

// ---------- 内置能力注册(骨架:M0 空壳,M1 起 browser 真实实现) ----------

/** 懒加载基座:统一 启动/停止/状态 管理,子模块只提供 start/stop 实现 */
export function createCapabilityBase(name, impl) {
  let state = CAP_STATUS.IDLE;
  let lastError = "";
  let idleTimer = null;
  const IDLE_TIMEOUT_MS = 600_000; // 空闲 10 分钟回收
  const stateObj = {
    name,
    status: () => ({ state, error: lastError }),
    isRunning: () => state === CAP_STATUS.RUNNING,
    /** 懒启动:首次调用时拉起 */
    ensure() {
      if (state === CAP_STATUS.RUNNING) return Promise.resolve();
      if (state === CAP_STATUS.STARTING) return Promise.resolve(); // 已启动中
      state = CAP_STATUS.STARTING;
      lastError = "";
      try {
        return Promise.resolve(impl.start && impl.start(stateObj)).then(
          () => { state = CAP_STATUS.RUNNING; stateObj._armIdle(); },
          (e) => { state = CAP_STATUS.ERROR; lastError = (e && e.message) || String(e); throw e; }
        );
      } catch (e) {
        state = CAP_STATUS.ERROR;
        lastError = (e && e.message) || String(e);
        throw e;
      }
    },
    /** 空闲回收 */
    _armIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (state === CAP_STATUS.RUNNING && impl.stop) {
          state = CAP_STATUS.RECYCLING;
          try { impl.stop(stateObj); } catch {}
          state = CAP_STATUS.IDLE;
        }
      }, IDLE_TIMEOUT_MS);
    },
    /** 手动停止 */
    stop() {
      clearTimeout(idleTimer);
      if (state === CAP_STATUS.RUNNING && impl.stop) { try { impl.stop(stateObj); } catch {} }
      state = CAP_STATUS.IDLE;
    },
  };
  return stateObj;
}

// 空壳能力:storage / network(实现 M2 填充;browser 已由 M1 真实实现)
const shell = (name) => createCapabilityBase(name, {
  start() { /* 待实现 */ },
  stop() { /* 待实现 */ },
});

export async function initCapabilities() {
  // browser:真实实现(懒加载 CDP 代理,见 browser/index.js)——动态引入避免循环依赖
  if (!registry.has("browser")) {
    const { browserCap } = await import("./browser/index.js");
    registerCapability("browser", browserCap);
  }
  // storage:真实实现(目录 + WebDAV 备份,见 storage/index.js)
  if (!registry.has("storage")) {
    const { storageCap } = await import("./storage/index.js");
    registerCapability("storage", storageCap);
  }
  for (const name of ["network"]) {
    if (!registry.has(name)) registerCapability(name, shell(name));
  }
}
