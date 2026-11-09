import ObjC from "frida-objc-bridge";

function timestamp() {
    const now = new Date();
    const pad = (value) => value.toString().padStart(2, "0");
    return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function objectFromPointer(pointer) {
    if (!pointer) return null;
    if (pointer.handle) return pointer;
    if (pointer.isNull && pointer.isNull()) return null;
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

function urlFromResponse(pointer) {
    try {
        const response = objectFromPointer(pointer);
        return response ? urlFromObject(response.URL(), false) : "";
    } catch (_) {
        return "";
    }
}

function currentUrlFromWebView(pointer) {
    try {
        const webView = objectFromPointer(pointer);
        return webView ? urlFromObject(webView.URL(), false) : "";
    } catch (_) {
        return "";
    }
}

export function startWebViewHook() {
    console.log("[WebView Monitor] Loading WebView navigation hooks");
    let hookCount = 0;
    let retryCount = 0;
    const hookedMethods = new Set();

    function sendNavigation(url, source, metadata = {}) {
        const normalizedUrl = url.trim().toLowerCase();
        if (!normalizedUrl || normalizedUrl === "about:blank" || normalizedUrl === "about:srcdoc") return;
        send({
            type: "webview",
            timestamp: timestamp(),
            url,
            source,
            ...metadata
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

    function hookNavigationDelegate(delegatePointer) {
        const delegate = objectFromPointer(delegatePointer);
        if (!delegate || !delegate.$className) return;

        const className = delegate.$className;
        hookMethod(className, "- webView:decidePolicyForNavigationAction:decisionHandler:", (args) => {
            const action = objectFromPointer(args[3]);
            const request = action ? action.request() : null;
            sendNavigation(urlFromObject(request, true), "WKNavigationDelegate navigation action");
        });
        hookMethod(className, "- webView:decidePolicyForNavigationAction:preferences:decisionHandler:", (args) => {
            const action = objectFromPointer(args[3]);
            const request = action ? action.request() : null;
            sendNavigation(urlFromObject(request, true), "WKNavigationDelegate navigation action");
        });
        hookMethod(className, "- webView:decidePolicyForNavigationResponse:decisionHandler:", (args) => {
            const navigationResponse = objectFromPointer(args[3]);
            const response = navigationResponse ? navigationResponse.response() : null;
            if (!response) return;

            let statusCode = null;
            let redirectTo = "";
            try {
                if (response.isKindOfClass_(ObjC.classes.NSHTTPURLResponse)) {
                    statusCode = response.statusCode().toString();
                    const headers = response.allHeaderFields();
                    const location = headers.objectForKey_("Location") || headers.objectForKey_("location");
                    redirectTo = location ? location.toString() : "";
                }
            } catch (_) {}

            sendNavigation(urlFromResponse(response), "WKNavigationDelegate navigation response", {
                status_code: statusCode,
                redirect_to: redirectTo
            });
        });
        hookMethod(className, "- webView:didReceiveServerRedirectForProvisionalNavigation:", (args) => {
            sendNavigation(currentUrlFromWebView(args[2]), "WKNavigationDelegate server redirect");
        });
    }

    function installAvailableHooks() {
        hookMethod("WKWebView", "- setNavigationDelegate:", (args) => {
            hookNavigationDelegate(args[2]);
        });
        hookMethod("WKWebView", "- loadRequest:", (args) => {
            const webView = objectFromPointer(args[0]);
            if (webView && webView.navigationDelegate) hookNavigationDelegate(webView.navigationDelegate());
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
