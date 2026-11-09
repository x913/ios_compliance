import ObjC from "frida-objc-bridge";

// =================================================================
// iOS 隐私合规全量监控模块
// =================================================================

export function startPrivacyHook() {
    console.log("[Privacy Monitor] 正在加载模块: Privacy Monitor 模块");
    let hookCount = 0;

    const CONFIG = {
        enableStack: true,
        maxPasteboardLength: 200
    };

    // 日志发送
    function sendLog(context, category, funcName, methodDesc, content) {
        let stack = "Disabled";
        if (CONFIG.enableStack) {
            try {
                stack = Thread.backtrace(context, Backtracer.FUZZY)
                    .map(DebugSymbol.fromAddress)
                    .join('\n');
            } catch (e) { stack = "Could not capture stack trace"; }
        }

        send({
            "type": "info",
            "category": category,
            "timestamp": (function(d) {
                var year = d.getFullYear();
                var month = (d.getMonth() + 1).toString().padStart(2, '0');
                var day = d.getDate().toString().padStart(2, '0');
                var hour = d.getHours().toString().padStart(2, '0');
                var min = d.getMinutes().toString().padStart(2, '0');
                var sec = d.getSeconds().toString().padStart(2, '0');
                return `${year}/${month}/${day}, ${hour}:${min}:${sec}`;
            })(new Date()), // Changed format to YYYY/MM/DD, HH:MM:SS
            "func": funcName,
            "method": methodDesc,
            "content": String(content),
            "stack": stack
        });
    }

    // 核心 Hook 函数
    function safeHook(className, method, category, actionDesc, valueParser) {
        try {
            const clazz = ObjC.classes[className];
            if (!clazz) return false;
            
            const targetMethod = clazz[method];
            if (!targetMethod) return false;

            Interceptor.attach(targetMethod.implementation, {
                onEnter: function(args) {
                    if (valueParser && valueParser.onEnter) {
                        this.enterInfo = valueParser.onEnter(args);
                    }
                },
                onLeave: function(retval) {
                    try {
                        let content = actionDesc;
                        let displayFunc = `${method.startsWith('+') ? '+' : '-'}[${className} ${method}]`;

                        if (valueParser && valueParser.onLeave) {
                            content = valueParser.onLeave(retval, this.enterInfo);
                        } else if (method.includes('advertisingIdentifier') || method.includes('identifierForVendor')) {
                            const obj = ObjC.Object(retval);
                            if (obj && obj.UUIDString) content = obj.UUIDString().toString();
                        }
                        sendLog(this.context, category, displayFunc, actionDesc, content);
                    } catch (e) {}
                }
            });
            return true;
        } catch (e) {
            console.error(`[!] Hook Failed: ${className} ${method}`);
            return false;
        }
    }

    // 注入逻辑
    if (ObjC.available) {

        // 地理位置监控
        const locationTargets = [
            // 启动定位
            { cls: "CLLocationManager", m: "- startUpdatingLocation", cat: "Start continuous location updates", d: "Continuous location updates started" },
            // 单次定位 iOS 9+
            { cls: "CLLocationManager", m: "- requestLocation", cat: "Request one-time location", d: "One-time location requested" },
            { cls: "CLLocationManager", m: "- startMonitoringSignificantLocationChanges", cat: "Start significant-change monitoring", d: "Monitoring significant location changes" },
            { cls: "CLLocationManager", m: "- startMonitoringForRegion:", cat: "Start region monitoring", d: "Monitoring a geographic region" },
            
            // 权限申请
            { cls: "CLLocationManager", m: "- requestWhenInUseAuthorization", cat: "Request location authorization", d: "Requesting When In Use location access" },
            { cls: "CLLocationManager", m: "- requestAlwaysAuthorization", cat: "Request location authorization", d: "Requesting Always location access" },
            
            // 修改位置
            { cls: "CLLocationManager", m: "- setAllowsBackgroundLocationUpdates:", cat: "Configure background location", d: "Configure background location updates" },
            { cls: "CLLocationManager", m: "- setDesiredAccuracy:", cat: "Configure location accuracy", d: "Set desired location accuracy" }
        ];

        locationTargets.forEach(t => {
            if (safeHook(t.cls, t.m, "Location", t.cat, {
                onEnter: function(args) {
                    // 获取位置数据
                    if (t.m.includes("setDesiredAccuracy:")) return "Desired accuracy: " + args[2].toDouble();
                    if (t.m.includes("setAllowsBackgroundLocationUpdates:")) return "Background updates: " + (args[2].toInt32() === 1 ? "Enabled" : "Disabled");
                    return null;
                },
                onLeave: function(retval, enterInfo) {
                    return enterInfo || t.d;
                }
            })) hookCount++;
        });


        // 相册监控
        const photoLibraryTargets = [
            // 获取共享实例
            { cls: "PHPhotoLibrary", m: "+ sharedPhotoLibrary", cat: "PhotoLibrary", d: "Access photo library", content: "Accessed the shared photo-library instance" },
            // 权限申请
            { cls: "PHPhotoLibrary", m: "+ requestAuthorization:", cat: "PhotoLibrary", d: "Request photo-library authorization", content: "Requesting photo-library authorization" },
            { cls: "PHPhotoLibrary", m: "+ requestAuthorizationForAccessLevel:handler:", cat: "PhotoLibrary", d: "Request photo-library authorization", content: "Requesting photo-library authorization" },
            // 内容修改
            { cls: "PHPhotoLibrary", m: "- performChanges:completionHandler:", cat: "PhotoLibrary", d: "Modify photo library", content: "Attempting asynchronous photo-library changes" },
            { cls: "PHPhotoLibrary", m: "- performChangesAndWait:error:", cat: "PhotoLibrary", d: "Modify photo library", content: "Attempting synchronous photo-library changes" }
        ];

        photoLibraryTargets.forEach(t => {
            if (safeHook(t.cls, t.m, t.cat, t.d, {
                onLeave: function(retval) {
                    return t.content; // 直接返回 Tweak 中定义的中文描述
                }
            })) hookCount++;
        });


        // 通讯录/相册/媒体设备监控
        const privacyTargets = [
            { cls: "CNContactStore", m: "- requestAccessForEntityType:completionHandler:", cat: "Contacts", d: "Request contacts access" },
            { cls: "AVCaptureDevice", m: "+ requestAccessForMediaType:completionHandler:", cat: "MediaDevice", d: "Request camera or microphone access" },
            { cls: "ATTrackingManager", m: "+ requestTrackingAuthorizationWithCompletionHandler:", cat: "App Tracking Transparency", d: "Request ATT authorization" },
            { cls: "ASIdentifierManager", m: "- advertisingIdentifier", cat: "IDFA", d: "Read IDFA" },
            { cls: "UIDevice", m: "- identifierForVendor", cat: "IDFV", d: "Read IDFV" }
        ];

        privacyTargets.forEach(t => {
            if (safeHook(t.cls, t.m, t.cat, t.d)) hookCount++;
        });

        // 剪切板监控
        const pbMethods = [
            { m: "- string", d: "Read pasteboard text" },
            { m: "- setString:", d: "Write pasteboard text" },
            { m: "- URL", d: "Read pasteboard URL" },
            { m: "- setURL", d: "Write pasteboard URL" },
            { m: "- items", d: "Read pasteboard items" },
            { m: "- setItems", d: "Write pasteboard items" },
        ];

        ["UIPasteboard", "_UIConcretePasteboard"].forEach(cls => {
            if (ObjC.classes[cls]) {
                pbMethods.forEach(method => {
                    if (safeHook(cls, method.m, "Pasteboard", method.d, {
                        onLeave: function(retval) {
                            if (retval.isNull()) return "Empty";
                            try {
                                const obj = ObjC.Object(retval);
                                let str = obj.toString();
                                return str.length > CONFIG.maxPasteboardLength ? str.substring(0, CONFIG.maxPasteboardLength) + "..." : str;
                            } catch (e) { return "Binary/Object Data"; }
                        }
                    })) hookCount++;
                });
            }
        });

        // Keychain 监控
        // const keychainFunctions = [
        //     { name: "SecItemCopyMatching", module: "Security", cat: "Keychain", desc: "查询Keychain" },
        //     { name: "SecItemAdd", module: "Security", cat: "Keychain", desc: "写入Keychain" },
        //     { name: "SecItemUpdate", module: "Security", cat: "Keychain", desc: "更新Keychain" },
        //     { name: "SecItemDelete", module: "Security", cat: "Keychain", desc: "删除Keychain" }
        // ];

        // keychainFunctions.forEach(f => {
        //     const funcPtr = Module.findExportByName(f.module, f.name);
        //     if (funcPtr) {
        //         Interceptor.attach(funcPtr, {
        //             onEnter: function(args) {
        //                 // args[0] 用于查询或操作的参数
        //                 const queryPtr = args[0];
        //                 let detail = "无参数详情";

        //                 if (!queryPtr.isNull()) {
        //                     try {
        //                         // 将 CFDictionaryRef 转换为 ObjC 读取内容
        //                         const params = new ObjC.Object(queryPtr);
        //                         // 转换为 JSON 字符串或选择性提取关键字段
        //                         detail = params.toString(); 
        //                     } catch (e) {
        //                         detail = "解析参数失败: " + e.message;
        //                     }
        //                 }
        //                 sendLog(this.context, f.cat, f.name, f.desc, detail);
        //             }
        //         });
        //     }
        // });


        // Keychain 监控
        const keychainFunctions = [
            { name: "SecItemCopyMatching", cat: "Keychain", desc: "Query Keychain" },
            { name: "SecItemAdd", cat: "Keychain", desc: "Add Keychain item" },
            { name: "SecItemUpdate", cat: "Keychain", desc: "Update Keychain item" },
            { name: "SecItemDelete", cat: "Keychain", desc: "Delete Keychain item" }
        ];

        keychainFunctions.forEach(f => {
            const funcPtr = Module.findGlobalExportByName(f.name);
            if (funcPtr) {
                Interceptor.attach(funcPtr, {
                    onEnter: function(args) {
                        let detail = "No argument details";

                        try {
                            if (f.name === "SecItemUpdate") {
                                // SecItemUpdate 特殊处理：获取两个参数
                                const queryPtr = args[0];
                                const updatePtr = args[1];
                                
                                let queryStr = queryPtr.isNull() ? "null" : new ObjC.Object(queryPtr).toString();
                                let updateStr = updatePtr.isNull() ? "null" : new ObjC.Object(updatePtr).toString();
                                
                                detail = "Query: " + queryStr + " Update: " + updateStr;
                            } else {
                                // 其他函数（Add, Delete, Copy）通常只关注第一个参数
                                const queryPtr = args[0];
                                if (!queryPtr.isNull()) {
                                    detail = new ObjC.Object(queryPtr).toString();
                                }
                            }
                        } catch (e) {
                            detail = "Could not parse arguments: " + e.message;
                        }

                        sendLog(this.context, f.cat, f.name, f.desc, detail);
                    }
                });
                hookCount++;
            }
        });

        console.log(`[Privacy Monitor] 隐私合规监控模块已启动`);
    } else {
        console.error("[Privacy Monitor] ObjC Runtime 不可用");
    }

    return hookCount;
}
