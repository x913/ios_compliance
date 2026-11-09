// =================================================================
// 文件监控模块 (File Monitor) 
// =================================================================

function startFileHook() {
    console.log("[File Monitor] 加载模块: File Monitor 模块");
    
    // 防止 ObjC 未定义导致脚本崩溃
    if (typeof ObjC === 'undefined') {
        console.log("[File Monitor] 错误: 当前环境找不到 ObjC 对象，无法监控文件操作。");
        return;
    }

    if (!ObjC.available) {
        console.log("[File Monitor] Objective-C Runtime 未加载，无法监控文件操作。");
        return;
    }

    // 发送文件操作日志的
    function sendFileLog(context, funcName, opType, pathInfo) {
        var stackStr = "Stack unavailable";
        try {
            stackStr = Thread.backtrace(context, Backtracer.FUZZY)
                .map(DebugSymbol.fromAddress)
                .join('\n');
        } catch (e) {}

        send({
            "type": "file",
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
            "op": opType,
            "method": pathInfo,
            "stack": stackStr
        });
    }

    // =======================================================
    // 监控文件读取 (NSFileHandle)
    // =======================================================
    try {
        var NSFileHandle = ObjC.classes.NSFileHandle;
        if (NSFileHandle) {
            var hookRead = NSFileHandle['+ fileHandleForReadingAtPath:'];
            if (hookRead) {
                Interceptor.attach(hookRead.implementation, {
                    onEnter: function (args) {
                        try {
                            if (args[2] && args[2] != 0x0) {
                                var path = new ObjC.Object(args[2]).toString();
                                sendFileLog(this.context, "[NSFileHandle fileHandleForReadingAtPath]", "Read", path);
                            }
                        } catch (e) {
                            console.error("[File Monitor] fileHandleForReadingAtPath error: " + e);
                        }
                    }
                });
            }
        }
    } catch(e) { console.error("[File Monitor] Hook NSFileHandle Error: " + e); }

    // =======================================================
    // 监控文件管理操作 (NSFileManager)
    // =======================================================
    try {
        var NSFileManager = ObjC.classes.NSFileManager;
        if (NSFileManager) {
            
            // --- 创建文件 ---
            var hookCreate = NSFileManager['- createFileAtPath:contents:attributes:'];
            if (hookCreate) {
                Interceptor.attach(hookCreate.implementation, {
                    onEnter: function (args) {
                        try {
                            if (args[2] && args[2] != 0x0) {
                                var path = new ObjC.Object(args[2]).toString();
                                sendFileLog(this.context, "[NSFileManager createFileAtPath]", "Create", path);
                            }
                        } catch (e) {
                            console.error("[File Monitor] createFileAtPath error: " + e);
                        }
                    }
                });
            }

            // --- 复制文件 ---
            var hookCopy = NSFileManager['- copyItemAtPath:toPath:error:'];
            if (hookCopy) {
                Interceptor.attach(hookCopy.implementation, {
                    onEnter: function (args) {
                        try {
                            if (args[2] && args[2] != 0x0 && args[3] && args[3] != 0x0) {
                                var srcPath = new ObjC.Object(args[2]).toString();
                                var dstPath = new ObjC.Object(args[3]).toString();
                                var displayPath = srcPath + " \n➡️ " + dstPath;
                                sendFileLog(this.context, "[NSFileManager copyItemAtPath]", "Copy", displayPath);
                            }
                        } catch (e) {
                            console.error("[File Monitor] copyItemAtPath error: " + e);
                        }
                    }
                });
            }

            // --- 删除文件 ---
            var hookRemove = NSFileManager['- removeItemAtPath:error:'];
            if (hookRemove) {
                Interceptor.attach(hookRemove.implementation, {
                    onEnter: function (args) {
                        try {
                            if (args[2] && args[2] != 0x0) {
                                var path = new ObjC.Object(args[2]).toString();
                                sendFileLog(this.context, "[NSFileManager removeItemAtPath]", "Delete", path);
                            }
                        } catch (e) {
                            console.error("[File Monitor] removeItemAtPath error: " + e);
                        }
                    }
                });
            }
        }
    } catch(e) { console.error("[File Monitor] Hook NSFileManager Error: " + e); }


    // =======================================================
    // 监控 Plist 写入 
    // =======================================================
    try {
        var NSMutableDictionary = ObjC.classes.NSMutableDictionary;
        if (NSMutableDictionary) {
            var hookWrite = NSMutableDictionary['- writeToFile:atomically:'];
            if (hookWrite) {
                Interceptor.attach(hookWrite.implementation, {
                    onEnter: function (args) {
                        try {
                            if (args[2] && args[2] != 0x0) {
                                var path = new ObjC.Object(args[2]).toString();
                                sendFileLog(this.context, "[NSMutableDictionary writeToFile]", "Write plist", path);
                            }
                        } catch (e) {
                            console.error("[File Monitor] writeToFile error: " + e);
                        }
                    }
                });
            }
        }
    } catch(e) { console.error("[File Monitor] Hook Plist Error: " + e); }

    console.log("[File Monitor] File Monitor 模块加载完成");
}
