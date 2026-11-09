import ObjC from "frida-objc-bridge";

function timestamp() {
    const now = new Date();
    const pad = (value) => value.toString().padStart(2, "0");
    return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function objectFromPointer(pointer) {
    if (!pointer || pointer.isNull()) return null;
    return new ObjC.Object(pointer);
}

function urlFromObject(pointer, isRequest) {
    try {
        const object = objectFromPointer(pointer);
        if (!object) return "";

        const url = isRequest ? object.URL() : object;
        return url && url.absoluteString ? url.absoluteString().toString() : "";
    } catch (_) {
        return "";
    }
}

export function startWebViewHook() {
    console.log("[WebView Monitor] Loading WebView navigation hooks");
    let hookCount = 0;
    let retryCount = 0;
    const hookedMethods = new Set();

    function sendNavigation(url, source) {
        if (!url) return;
        send({
            type: "webview",
            timestamp: timestamp(),
            url,
            source
        });
    }

    function hookMethod(className, selector, handler) {
        const clazz = ObjC.classes[className];
        if (!clazz || !clazz[selector]) return false;

        const key = `${className}:${selector}`;
        if (hookedMethods.has(key)) return false;

        Interceptor.attach(clazz[selector].implementation, {
            onEnter(args) {
                try {
                    handler(args);
                } catch (error) {
                    console.error(`[WebView Monitor] ${key} failed: ${error}`);
                }
            }
        });
        hookedMethods.add(key);
        hookCount += 1;
        return true;
    }

    function installAvailableHooks() {
        hookMethod("WKWebView", "- loadRequest:", (args) => {
            sendNavigation(urlFromObject(args[2], true), "WKWebView loadRequest:");
        });
        hookMethod("WKWebView", "- loadHTMLString:baseURL:", (args) => {
            sendNavigation(urlFromObject(args[3], false), "WKWebView loadHTMLString:baseURL:");
        });
        hookMethod("WKWebView", "- loadFileURL:allowingReadAccessToURL:", (args) => {
            sendNavigation(urlFromObject(args[2], false), "WKWebView loadFileURL:");
        });
        hookMethod("UIWebView", "- loadRequest:", (args) => {
            sendNavigation(urlFromObject(args[2], true), "UIWebView loadRequest:");
        });
    }

    installAvailableHooks();

    // WebKit is often loaded after the app process starts. Retry briefly so
    // apps that create their first WKWebView later in startup are covered.
    const retryTimer = setInterval(() => {
        installAvailableHooks();
        retryCount += 1;
        if (retryCount >= 40) clearInterval(retryTimer);
    }, 500);

    return hookCount;
}
