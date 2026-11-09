/**
 * 全局状态管理
 */
export const state = {
    socket: null,
    currentMonitoredApp: null, // { name, bundleId, mode, deviceIp }
    pendingApp: null,          // 暂存待启动 App 信息
    selectedAnalysisApp: null,
    
    // Bootstrap Modal 实例缓存
    modals: {
        global: null,
        stack: null,
        config: null
    }
};
