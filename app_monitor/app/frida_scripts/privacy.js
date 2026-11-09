// =================================================================
// iOS 隐私合规全量监控模块
// =================================================================

function startPrivacyHook() {
    console.log("[Privacy Monitor] 正在加载模块: Privacy Monitor 模块");

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
            } catch (e) { stack = "获取堆栈失败"; }
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
            if (!clazz) return;
            
            const targetMethod = clazz[method];
            if (!targetMethod) return;

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
        } catch (e) {
            console.error(`[!] Hook Failed: ${className} ${method}`);
        }
    }

    // 注入逻辑
    if (ObjC.available) {

        // 地理位置监控
        const locationTargets = [
            // 启动定位
            { cls: "CLLocationManager", m: "- startUpdatingLocation", cat: "申请定位权限", d: "App 已启动持续定位" },
            // 单次定位 iOS 9+
            { cls: "CLLocationManager", m: "- requestLocation", cat: "申请定位权限", d: "请求单次定位" },
            { cls: "CLLocationManager", m: "- startMonitoringSignificantLocationChanges", cat: "启动定位", d: "App 已启动基于基站/Wi-Fi位置变化监控" },
            { cls: "CLLocationManager", m: "- startMonitoringForRegion:", cat: "启动地理围栏监控", d: "正在监控地理围栏" },
            
            // 权限申请
            { cls: "CLLocationManager", m: "- requestWhenInUseAuthorization", cat: "申请定位权限", d: "App 正在申请“仅在使用期间”访问位置的权限" },
            { cls: "CLLocationManager", m: "- requestAlwaysAuthorization", cat: "申请定位权限", d: "App 正在申请“始终访问”位置的权限" },
            
            // 修改位置
            { cls: "CLLocationManager", m: "- setAllowsBackgroundLocationUpdates:", cat: "申请定位权限", d: "修改是否允许后台定位" },
            { cls: "CLLocationManager", m: "- setDesiredAccuracy:", cat: "修改定位", d: "修改定位精度" }
        ];

        locationTargets.forEach(t => {
            safeHook(t.cls, t.m, "Location", t.cat, {
                onEnter: function(args) {
                    // 获取位置数据
                    if (t.m.includes("setDesiredAccuracy:")) return "精度设为: " + args[2].toDouble();
                    if (t.m.includes("setAllowsBackgroundLocationUpdates:")) return "后台更新: " + (args[2].toInt32() === 1 ? "开启" : "关闭");
                    return null;
                },
                onLeave: function(retval, enterInfo) {
                    return enterInfo || t.d;
                }
            });
        });


        // 相册监控
        const photoLibraryTargets = [
            // 获取共享实例
            { cls: "PHPhotoLibrary", m: "+ sharedPhotoLibrary", cat: "PhotoLibrary", d: "获取照片库", content: "已访问共享照片库实例" },
            // 权限申请
            { cls: "PHPhotoLibrary", m: "+ requestAuthorization:", cat: "PhotoLibrary", d: "获取相册权限", content: "申请相册权限" },
            { cls: "PHPhotoLibrary", m: "+ requestAuthorizationForAccessLevel:handler:", cat: "PhotoLibrary", d: "获取相册权限", content: "申请相册权限" },
            // 内容修改
            { cls: "PHPhotoLibrary", m: "- performChanges:completionHandler:", cat: "PhotoLibrary", d: "修改相册内容", content: "正在尝试异步修改相册内容" },
            { cls: "PHPhotoLibrary", m: "- performChangesAndWait:error:", cat: "PhotoLibrary", d: "修改相册内容", content: "正在尝试同步修改相册内容" }
        ];

        photoLibraryTargets.forEach(t => {
            safeHook(t.cls, t.m, t.cat, t.d, {
                onLeave: function(retval) {
                    return t.content; // 直接返回 Tweak 中定义的中文描述
                }
            });
        });


        // 通讯录/相册/媒体设备监控
        const privacyTargets = [
            { cls: "CNContactStore", m: "- requestAccessForEntityType:completionHandler:", cat: "Contacts", d: "访问通讯录" },
            { cls: "AVCaptureDevice", m: "+ requestAccessForMediaType:completionHandler:", cat: "MediaDevice", d: "访问摄像头/麦克风" },
            { cls: "ASIdentifierManager", m: "- advertisingIdentifier", cat: "IDFA", d: "获取IDFA" },
            { cls: "UIDevice", m: "- identifierForVendor", cat: "IDFV", d: "获取IDFV" }
        ];

        privacyTargets.forEach(t => safeHook(t.cls, t.m, t.cat, t.d));

        // 剪切板监控
        const pbMethods = [
            { m: "- string", d: "读取剪切板内容" },
            { m: "- setString:", d: "写入剪切板内容" },
            { m: "- URL", d: "读取剪切板URL" },
            { m: "- setURL", d: "写入剪切板URL" },
            { m: "- items", d: "读取剪切板内容" },
            { m: "- setItems", d: "写入剪切板内容" },
        ];

        ["UIPasteboard", "_UIConcretePasteboard"].forEach(cls => {
            if (ObjC.classes[cls]) {
                pbMethods.forEach(method => {
                    safeHook(cls, method.m, "Pasteboard", method.d, {
                        onLeave: function(retval) {
                            if (retval.isNull()) return "Empty";
                            try {
                                const obj = ObjC.Object(retval);
                                let str = obj.toString();
                                return str.length > CONFIG.maxPasteboardLength ? str.substring(0, CONFIG.maxPasteboardLength) + "..." : str;
                            } catch (e) { return "Binary/Object Data"; }
                        }
                    });
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
            { name: "SecItemCopyMatching", cat: "Keychain", desc: "查询Keychain" },
            { name: "SecItemAdd", cat: "Keychain", desc: "写入Keychain" },
            { name: "SecItemUpdate", cat: "Keychain", desc: "更新Keychain" },
            { name: "SecItemDelete", cat: "Keychain", desc: "删除Keychain" }
        ];

        keychainFunctions.forEach(f => {
            const funcPtr = Module.findGlobalExportByName(f.name);
            if (funcPtr) {
                Interceptor.attach(funcPtr, {
                    onEnter: function(args) {
                        let detail = "无参数详情";

                        try {
                            if (f.name === "SecItemUpdate") {
                                // SecItemUpdate 特殊处理：获取两个参数
                                const queryPtr = args[0];
                                const updatePtr = args[1];
                                
                                let queryStr = queryPtr.isNull() ? "null" : new ObjC.Object(queryPtr).toString();
                                let updateStr = updatePtr.isNull() ? "null" : new ObjC.Object(updatePtr).toString();
                                
                                detail = "查询：" + queryStr + " 更新：" + updateStr;
                            } else {
                                // 其他函数（Add, Delete, Copy）通常只关注第一个参数
                                const queryPtr = args[0];
                                if (!queryPtr.isNull()) {
                                    detail = new ObjC.Object(queryPtr).toString();
                                }
                            }
                        } catch (e) {
                            detail = "解析参数失败: " + e.message;
                        }

                        sendLog(this.context, f.cat, f.name, f.desc, detail);
                    }
                });
            }
        });

        console.log(`[Privacy Monitor] 隐私合规监控模块已启动`);
    } else {
        console.error("[Privacy Monitor] ObjC Runtime 不可用");
    }
}
