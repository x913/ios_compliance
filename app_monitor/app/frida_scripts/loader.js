// =================================================================
// 监控模块加载 (Monitor loader) - 修复版
// =================================================================

// 全局环境与状态
const _global = typeof globalThis !== 'undefined' ? globalThis : (0, eval)("this");
_global.hooksLoaded = false;

// RPC 导出
rpc.exports = {
    checkStatus: function() {
        return {
            objc: ObjC.available,
            hooks_loaded: _global.hooksLoaded
        };
    }
};

(function() {
    // 配置项
    const CFG = {
        maxRetries: 100,
        pollInterval: 200,
        targetLibs: ['libobjc', 'UIKit', 'CoreFoundation']
    };

    console.log(`[Loader] 注入成功 (Frida ${Frida.version})`);

    // 检测 ObjC 环境
    function isObjCReady() {
        return ObjC.available && "NSString" in ObjC.classes;
    }

    // 执行业务 Hook
    function performHooks() {
        if (_global.hooksLoaded) return;
        if (!isObjCReady()) return;

        console.log("[Loader] ObjC Runtime 环境就绪，开始加载监听模块...");

        // 定义需要加载的模块名称和对应的入口函数
        const modules = [
            { name: "防锁屏", fn: "startAntiLock" },
            { name: "网络监控", fn: "startNetworkHook" },
            { name: "文件监控", fn: "startFileHook" },
            { name: "隐私监控", fn: "startPrivacyHook" },
            // [核心修改] 添加 SDK 检测模块入口
            { name: "SDK检测", fn: "startSDKCheck" } 
        ];

        let successCount = 0;
        modules.forEach(mod => {
            const fn = _global[mod.fn];
            if (typeof fn === 'function') {
                try {
                    fn(); // 调用模块启动函数
                    console.log(`[Loader] ${mod.name} 模块已启动`);
                    successCount++;
                } catch (e) {
                    console.error(`[-] ${mod.name} 加载失败: ${e.message}`);
                }
            } else {
                // 可选：打印警告，方便排查哪个函数没定义
                // console.warn(`[Loader] 未找到函数: ${mod.fn} (可能是对应脚本文件未加载)`);
            }
        });

        _global.hooksLoaded = true;
        send({ type: "sys_log", payload: { msg: `Hooks 已生效 (加载: ${successCount}/${modules.length})` } });
        console.log("==========================================");
    }

    // dlopen 监听 
    function setupDlopenMonitor() {
        const dlopen = Module.findGlobalExportByName("dlopen");
        if (!dlopen) return;

        try {
            Interceptor.attach(dlopen, {
                onEnter: function(args) {
                    this.path = args[0].isNull() ? "" : args[0].readUtf8String();
                },
                onLeave: function(retval) {
                    if (_global.hooksLoaded) return;
                    // 检查是否加载了关键库
                    if (this.path && CFG.targetLibs.some(lib => this.path.indexOf(lib) !== -1)) {
                        // 稍微延时，等待库初始化完成
                        setTimeout(performHooks, 50);
                    }
                }
            });
            console.log("[Loader] dlopen 监听已启用。");
        } catch (e) {
            console.error("[Loader] dlopen 监听失败: " + e.message);
        }
    }

    // 轮询检查
    function startPolling() {
        let retries = 0;
        
        function loop() {
            if (_global.hooksLoaded) return;

            if (isObjCReady()) {
                performHooks();
                return;
            }

            if (retries++ > CFG.maxRetries) {
                console.error("[Loader] 加载超时: 未检测到 ObjC 环境，停止尝试。");
                return;
            }
            
            setTimeout(loop, CFG.pollInterval);
        }
        
        // 立即开始
        setupDlopenMonitor();
        loop();
    }

    // 启动
    setImmediate(startPolling);

})();
