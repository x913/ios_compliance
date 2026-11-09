import ObjC from "frida-objc-bridge";
import bundledSdkRules from "./ios_sdk_rules.json";

// =================================================================
// SDK 检测模块
// =================================================================

export function startSDKCheck() {
    console.log("[SDK] 加载模块: Check-SDK");

    if (!ObjC.available) {
        console.error("[-] Objective-C Runtime 未加载");
        return;
    }

    // The JSON rules are bundled with the agent at build time.
    var sdkDatabase = bundledSdkRules;

    // 2. 如果规则为空或未定义，使用兜底规则进行测试
    if (!sdkDatabase || !Array.isArray(sdkDatabase) || sdkDatabase.length === 0) {
        console.warn("[SDK] ⚠️ 规则库为空，加载测试规则");
        sdkDatabase = [
            { name: "UI_TEST", class: ["UIView", "UIApplication"] }, // 必中的规则
            { name: "NET_TEST", class: ["NSURLSession"] }
        ];
    }

    console.log("[SDK] 当前生效规则数量: " + sdkDatabase.length);

    var results = [];
    var foundSet = new Set();

    // -------------------------------------------------------------
    // Class 检测
    // -------------------------------------------------------------
    for (var i = 0; i < sdkDatabase.length; i++) {
        var item = sdkDatabase[i];
        if (foundSet.has(item.name)) continue;

        if (item.class && item.class.length > 0) {
            for (var k = 0; k < item.class.length; k++) {
                var className = item.class[k];
                // 核心检测
                if (ObjC.classes[className]) {
                    var catStr = (item.category || []).join(", ") || "其它";
                    results.push({
                        name: item.name,
                        category: catStr,
                        match: "Class: " + className
                    });
                    foundSet.add(item.name);
                    break; 
                }
            }
        }
    }

    // -------------------------------------------------------------
    // 模块路径检测
    // -------------------------------------------------------------
    if (results.length < sdkDatabase.length) {
        var loadedModules = Process.enumerateModules().map(function(m){ return m.path; });
        for (var i = 0; i < sdkDatabase.length; i++) {
            var item = sdkDatabase[i];
            if (foundSet.has(item.name)) continue;

            if (item.file && item.file.length > 0) {
                for (var j = 0; j < item.file.length; j++) {
                    var fileKey = item.file[j];
                    for (var m = 0; m < loadedModules.length; m++) {
                        if (loadedModules[m].indexOf(fileKey) !== -1) {
                            var catStr = (item.category || []).join(", ") || "其它";
                            results.push({
                                name: item.name,
                                category: catStr,
                                match: "Module: " + fileKey
                            });
                            foundSet.add(item.name);
                            break;
                        }
                    }
                    if (foundSet.has(item.name)) break;
                }
            }
        }
    }

    // 4. 发送结果
    console.log("[SDK] 检测结束，共发现: " + results.length + " 个");
    send({ type: "sdk", data: results });
}

// // 导出函数供 loader 调用
// function startSDKCheck() {
//     // 立即执行一次日志，确认函数被调用了
//     console.log("[SDK] startSDKCheck 被调用，将在 2秒 后执行...");
//     setTimeout(checkSDKs, 2000);
// }
