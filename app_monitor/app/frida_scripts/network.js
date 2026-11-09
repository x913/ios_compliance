import ObjC from "frida-objc-bridge";

// =================================================================
// Network monitor
// =================================================================

const MAX_CAPTURED_BODY_BYTES = 256 * 1024;

export function startNetworkHook() {
    console.log("[Network Monitor] Loading network monitor");
    let hookCount = 0;
    let requestSequence = 0;
    const pendingCompletionBlocks = new Set();

    function timestamp() {
        const now = new Date();
        const pad = (value) => value.toString().padStart(2, "0");
        return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}, ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    function requestId() {
        requestSequence += 1;
        return `request-${Date.now()}-${requestSequence}`;
    }

    function objectFromPointer(pointer) {
        if (!pointer) return null;
        if (pointer.handle) return pointer;
        if (pointer.isNull && pointer.isNull()) return null;
        return new ObjC.Object(pointer);
    }

    function nsDataToString(data) {
        try {
            if (!data) return "";
            const length = Number(data.length());
            if (length === 0) return "";
            if (length > MAX_CAPTURED_BODY_BYTES) {
                return `[Body omitted: ${length} bytes exceeds ${MAX_CAPTURED_BODY_BYTES}-byte limit]`;
            }

            const string = ObjC.classes.NSString.alloc().initWithData_encoding_(data, 4);
            return string ? string.toString() : `[Binary data: ${length} bytes]`;
        } catch (error) {
            return "[Body conversion failed]";
        }
    }

    function nsDictToObject(dict) {
        try {
            const result = {};
            if (!dict) return result;

            const keys = dict.allKeys();
            const count = keys.count();
            for (let index = 0; index < count; index += 1) {
                const key = keys.objectAtIndex_(index).toString();
                const value = dict.objectForKey_(key);
                result[key] = value ? value.toString() : "";
            }
            return result;
        } catch (error) {
            return {};
        }
    }

    function emitRequest(method, url, headers, body) {
        const data = {
            type: "network",
            request_id: requestId(),
            timestamp: timestamp(),
            method,
            url,
            headers,
            body
        };
        send(data);
        return data;
    }

    function handleRequest(request) {
        let url = "Unknown URL";
        let method = "GET";
        let headers = {};
        let body = "";

        try {
            if (request.URL && request.URL()) {
                url = request.URL().absoluteString().toString();
            }
            if (request.HTTPMethod && request.HTTPMethod()) {
                method = request.HTTPMethod().toString();
            }
            if (request.allHTTPHeaderFields && request.allHTTPHeaderFields()) {
                headers = nsDictToObject(request.allHTTPHeaderFields());
            }
            if (request.HTTPBody && request.HTTPBody()) {
                body = nsDataToString(request.HTTPBody());
            }
        } catch (error) {
            console.error(`[Network] Request parsing failed: ${error}`);
        }

        return emitRequest(method, url, headers, body);
    }

    function handleURL(url, session) {
        let urlString = "Unknown URL";
        let headers = {};

        try {
            urlString = url.absoluteString().toString();
            if (session && session.configuration) {
                const configuration = session.configuration();
                const additionalHeaders = configuration.HTTPAdditionalHeaders();
                if (additionalHeaders) headers = nsDictToObject(additionalHeaders);
            }
        } catch (error) {
            console.error(`[Network] URL request parsing failed: ${error}`);
        }

        return emitRequest("GET", urlString, headers, "");
    }

    function errorDescription(errorPointer) {
        try {
            const error = objectFromPointer(errorPointer);
            return error ? error.localizedDescription().toString() : "";
        } catch (error) {
            return "[Response error could not be read]";
        }
    }

    function emitResponse(request, responsePointer, bodyPointer, errorPointer, isDownload) {
        try {
            const response = objectFromPointer(responsePointer);
            const bodyObject = objectFromPointer(bodyPointer);
            const headers = response && response.allHeaderFields
                ? nsDictToObject(response.allHeaderFields())
                : {};
            const isHttpResponse = response
                && response.isKindOfClass_(ObjC.classes.NSHTTPURLResponse);
            const statusCode = isHttpResponse ? response.statusCode().toString() : null;
            const responseUrl = response && response.URL && response.URL()
                ? response.URL().absoluteString().toString()
                : request.url;

            let body = "";
            if (isDownload) {
                body = bodyObject && bodyObject.absoluteString
                    ? `[Downloaded file: ${bodyObject.absoluteString().toString()}]`
                    : "[Download completed]";
            } else {
                body = nsDataToString(bodyObject);
            }

            send({
                type: "network_response",
                request_id: request.request_id,
                timestamp: timestamp(),
                url: responseUrl,
                status_code: statusCode,
                headers,
                body,
                error: errorDescription(errorPointer)
            });
        } catch (error) {
            console.error(`[Network] Response parsing failed: ${error}`);
        }
    }

    function wrapCompletionHandler(blockPointer, request, isDownload) {
        if (!blockPointer || blockPointer.isNull()) return;

        try {
            const block = new ObjC.Block(blockPointer);
            if (block.types === undefined) {
                block.declare({ retType: "void", argTypes: ["object", "object", "object"] });
            }
            const originalImplementation = block.implementation;
            pendingCompletionBlocks.add(block);

            block.implementation = function (body, response, error) {
                try {
                    emitResponse(request, response, body, error, isDownload);
                } finally {
                    try {
                        return originalImplementation.apply(this, arguments);
                    } finally {
                        pendingCompletionBlocks.delete(block);
                    }
                }
            };
        } catch (error) {
            console.error(`[Network] Completion handler hook failed: ${error}`);
        }
    }

    try {
        const sessionClass = ObjC.classes.NSURLSession;
        if (!sessionClass) return hookCount;

        const selectors = [
            { name: "- dataTaskWithRequest:", argumentIndex: 2 },
            { name: "- dataTaskWithRequest:completionHandler:", argumentIndex: 2, completionIndex: 3 },
            { name: "- dataTaskWithRequest:uploadProgress:downloadProgress:completionHandler:", argumentIndex: 2, completionIndex: 5 },
            { name: "- dataTaskWithURL:", argumentIndex: 2 },
            { name: "- dataTaskWithURL:completionHandler:", argumentIndex: 2, completionIndex: 3 },
            { name: "- uploadTaskWithRequest:fromData:", argumentIndex: 2 },
            { name: "- uploadTaskWithRequest:fromData:completionHandler:", argumentIndex: 2, completionIndex: 4 },
            { name: "- uploadTaskWithStreamedRequest:", argumentIndex: 2 },
            { name: "- downloadTaskWithRequest:", argumentIndex: 2 },
            { name: "- downloadTaskWithRequest:completionHandler:", argumentIndex: 2, completionIndex: 3, isDownload: true },
            { name: "- downloadTaskWithURL:", argumentIndex: 2 },
            { name: "- downloadTaskWithURL:completionHandler:", argumentIndex: 2, completionIndex: 3, isDownload: true },
            { name: "- webSocketTaskWithURL:", argumentIndex: 2 },
            { name: "- webSocketTaskWithURL:protocols:", argumentIndex: 2 }
        ];

        selectors.forEach((selector) => {
            if (!sessionClass[selector.name]) return;

            Interceptor.attach(sessionClass[selector.name].implementation, {
                onEnter(args) {
                    try {
                        const session = objectFromPointer(args[0]);
                        const target = objectFromPointer(args[selector.argumentIndex]);
                        let request = null;

                        if (target && target.isKindOfClass_(ObjC.classes.NSURLRequest)) {
                            request = handleRequest(target);
                        } else if (target && target.isKindOfClass_(ObjC.classes.NSURL)) {
                            request = handleURL(target, session);
                        }

                        if (request && selector.completionIndex !== undefined) {
                            wrapCompletionHandler(args[selector.completionIndex], request, Boolean(selector.isDownload));
                        }
                    } catch (error) {
                        console.error(`[Network] Hook ${selector.name} failed: ${error}`);
                    }
                }
            });
            hookCount += 1;
        });
    } catch (error) {
        console.error(`[Network] Hook setup failed: ${error}`);
    }

    return hookCount;
}
