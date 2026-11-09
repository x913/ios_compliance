import ObjC from "frida-objc-bridge";

// =================================================================
// 防锁屏模块 (Anti-Lock)
// 设置 UIApplication.idleTimerDisabled = YES
// =================================================================

export function startAntiLock() {
    console.log("[Anti-Lock] 加载模块: Anti-Lock");
    if (!ObjC.available) return;

    // UI 操作必须在主线程执行
    ObjC.schedule(ObjC.mainQueue, function() {
        try {
            var UIApplication = ObjC.classes.UIApplication;
            if (UIApplication) {
                var app = UIApplication.sharedApplication();
                
                if (app) {
                    // 禁止空闲自动锁屏
                    app.setIdleTimerDisabled_(true);
                    
                    console.log("[Anti-Lock] 防锁屏已开启,设备屏幕将保持常亮");
                    
                    // 通知前端
                    send({
                        type: "sys_log",
                        msg: "⚡️ Keep-awake mode is active; the screen will stay on"
                    });
                }
            }
        } catch (e) {
            console.error("[!] Anti-Lock Error: " + e);
        }
    });
}
