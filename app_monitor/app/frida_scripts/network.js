import ObjC from "frida-objc-bridge";

// =================================================================
// 网络监控模块 (Network Monitor) 
// =================================================================

export function startNetworkHook() {
    console.log("[Network Monitor] 加载模块: Network Monitor 模块");
    let hookCount = 0;
    // 将NSData 转为 String
    function nsDataToString(data) {
        try {
            if (!data || data.length() === 0) return "";
            var str = ObjC.classes.NSString.alloc().initWithData_encoding_(data, 4); // UTF8
            if (str) {
                return str.toString();
            }
            return "[Binary Data] Length: " + data.length();
        } catch (e) {
            return "[Data Convert Error]";
        }
    }

    // 将 NSDictionary 转为 JS Object
    function nsDictToObject(dict) {
        try {
            var jsObj = {};
            if (!dict) return jsObj;
            
            var keys = dict.allKeys();
            var count = keys.count();
            for (var i = 0; i < count; i++) {
                var key = keys.objectAtIndex_(i).toString();
                var value = dict.objectForKey_(key).toString();
                jsObj[key] = value;
            }
            return jsObj;
        } catch (e) {
            return {};
        }
    }

    function handleRequest(request) {
        try {
            var urlStr = "Unknown URL";
            var method = "GET"; 
            var bodyContent = "";
            var headers = {};

            if (request && request.handle != 0x0) {
                try {
                    // 1. URL
                    if (request.URL && request.URL()) {
                        var url = request.URL();
                        if (url && url.absoluteString) {
                            urlStr = url.absoluteString().toString();
                        }
                    }

                    // 2. Method
                    if (request.HTTPMethod && request.HTTPMethod()) {
                        method = request.HTTPMethod().toString();
                    }

                    // 3. Headers 
                    if (request.allHTTPHeaderFields && request.allHTTPHeaderFields()) {
                        headers = nsDictToObject(request.allHTTPHeaderFields());
                    }

                    // 4. Body
                    if (request.HTTPBody && request.HTTPBody()) {
                        bodyContent = nsDataToString(request.HTTPBody());
                    }
                } catch (e) {
                    console.error("[Network] Request parsing error: " + e);
                }
            }

            send({
                "type": "network",
                "timestamp": (function(d) {
                    var year = d.getFullYear();
                    var month = (d.getMonth() + 1).toString().padStart(2, '0');
                    var day = d.getDate().toString().padStart(2, '0');
                    var hour = d.getHours().toString().padStart(2, '0');
                    var min = d.getMinutes().toString().padStart(2, '0');
                    var sec = d.getSeconds().toString().padStart(2, '0');
                    return `${year}/${month}/${day}, ${hour}:${min}:${sec}`;
                })(new Date()), // Changed format to YYYY/MM/DD, HH:MM:SS
                "method": method,
                "url": urlStr,
                "headers": headers, // 发送 Headers
                "body": bodyContent
            });

        } catch (e) {
            console.error("[Network] Extract Error: " + e);
        }
    }

    // Hook NSURLSession
    function handleURL(url, session) {
        var urlStr = url.absoluteString().toString();
        var finalHeaders = {};
        var hasHeaders = false;

        try {
            // 从当前 Session 的 Configuration 中提取默认 Header
            if (session && session.configuration) {
                var config = session.configuration();
                var additionalHeaders = config.HTTPAdditionalHeaders();
                if (additionalHeaders) {
                    finalHeaders = nsDictToObject(additionalHeaders);
                    // 检查是否有实际内容
                    if (Object.keys(finalHeaders).length > 0) {
                        hasHeaders = true;
                    }
                }
            }
        } catch (e) {
            console.error("[Network] 获取 Session Configuration 失败: " + e);
        }

        var logData = {
            "type": "network",
            "timestamp": (function(d) {
                return d.getFullYear() + "/" + 
                       (d.getMonth() + 1).toString().padStart(2, '0') + "/" + 
                       d.getDate().toString().padStart(2, '0') + ", " + 
                       d.getHours().toString().padStart(2, '0') + ":" + 
                       d.getMinutes().toString().padStart(2, '0') + ":" + 
                       d.getSeconds().toString().padStart(2, '0');
            })(new Date()),
            "method": "GET",
            "url": urlStr,
            "body": ""
        };

        // 只有存在 Header 时才写入字段
        if (hasHeaders) {
            logData["headers"] = finalHeaders;
        }

        send(logData);
    }

    try {
        var sessionClass = ObjC.classes.NSURLSession;
        if (sessionClass) {
            var selectors = [
                "- dataTaskWithRequest:",
                "- dataTaskWithRequest:completionHandler:",
                "- dataTaskWithRequest:uploadProgress:downloadProgress:completionHandler:",
                "- dataTaskWithURL:",
                "- dataTaskWithURL:completionHandler:",
                "- uploadTaskWithRequest:fromData:",
                "- uploadTaskWithRequest:fromData:completionHandler:",
                "- uploadTaskWithStreamedRequest:",
                "- downloadTaskWithRequest:",
                "- downloadTaskWithRequest:completionHandler:",
                "- downloadTaskWithURL:",
                "- downloadTaskWithURL:completionHandler:",
                "- webSocketTaskWithURL:",
                "- webSocketTaskWithURL:protocols:"
            ];

            selectors.forEach(function(sel) {
                if (sessionClass[sel]) {
                    Interceptor.attach(sessionClass[sel].implementation, {
                        onEnter: function(args) {
                            try {
                                var session = ObjC.Object(args[0]); // self
                                var arg2 = ObjC.Object(args[2]);    // request 或 url

                                if (arg2.isKindOfClass_(ObjC.classes.NSURLRequest)) {
                                    // 处理 Request 的逻辑也要同步修改：合并 session.config 的 Header
                                    handleRequest(arg2, session);
                                } else if (arg2.isKindOfClass_(ObjC.classes.NSURL)) {
                                    handleURL(arg2, session);
                                }
                            } catch (e) {
                                console.error("[Network] Hook " + sel + " 内部错误: " + e);
                            }
                        }
                    });
                    hookCount++;
                }
            });
        }
    } catch (e) { console.error("[Network] Hook 异常: " + e); }

    return hookCount;
}
