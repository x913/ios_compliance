import ObjC from "frida-objc-bridge";

const TECHNOLOGY_RULES = [
    {
        name: "Flutter",
        classes: ["FlutterEngine", "FlutterViewController"],
        markers: ["Flutter.framework", "App.framework"]
    },
    {
        name: "React Native",
        classes: ["RCTBridge", "RCTRootView"],
        markers: ["React-Core.framework", "React.framework", "ReactNative"]
    },
    {
        name: "Unity",
        classes: ["UnityAppController"],
        markers: ["UnityFramework.framework", "UnityPlayer"]
    },
    {
        name: "Cocos2d-x",
        classes: ["CCDirector", "CCGLView"],
        markers: ["Cocos2d", "cocos2d", "libcocos2d"]
    },
    {
        name: "Capacitor",
        classes: ["CAPBridgeViewController"],
        markers: ["Capacitor.framework"]
    },
    {
        name: "Apache Cordova",
        classes: ["CDVViewController"],
        markers: ["Cordova.framework"]
    },
    {
        name: "Xamarin/.NET",
        classes: [],
        markers: ["Xamarin.iOS", "Mono.framework", "libmonosgen"]
    }
];

function text(value, fallback = "") {
    if (value === null || value === undefined) return fallback;
    try {
        return value.toString();
    } catch (_) {
        return fallback;
    }
}

function listDirectory(path) {
    try {
        const manager = ObjC.classes.NSFileManager.defaultManager();
        const contents = manager.contentsOfDirectoryAtPath_error_(path, NULL);
        if (!contents) return [];

        const entries = [];
        const count = Number(contents.count());
        for (let index = 0; index < count; index += 1) {
            entries.push(text(contents.objectAtIndex_(index)));
        }
        return entries.sort((left, right) => left.localeCompare(right));
    } catch (_) {
        return [];
    }
}

function infoValue(info, key) {
    try {
        return text(info.objectForKey_(key));
    } catch (_) {
        return "";
    }
}

function detectTechnologies(frameworks, modules) {
    const haystack = frameworks.concat(modules.map((module) => module.path));
    const matches = [];

    TECHNOLOGY_RULES.forEach((rule) => {
        const evidence = [];
        let strongFrameworkMatch = false;

        rule.markers.forEach((marker) => {
            if (haystack.some((entry) => entry.includes(marker))) {
                evidence.push(`Framework/module: ${marker}`);
                if (marker !== "App.framework") strongFrameworkMatch = true;
            }
        });

        rule.classes.forEach((className) => {
            if (ObjC.classes[className]) evidence.push(`Runtime class: ${className}`);
        });

        if (evidence.length > 0) {
            matches.push({
                name: rule.name,
                confidence: strongFrameworkMatch ? "High" : "Medium",
                evidence
            });
        }
    });

    if (matches.length === 0) {
        matches.push({
            name: "Native iOS (Swift/Objective-C)",
            confidence: "Low",
            evidence: ["No cross-platform runtime or framework signature matched"]
        });
    }

    return matches;
}

rpc.exports = {
    inspect() {
        if (!ObjC.available) throw new Error("Objective-C runtime is not available in the target process");

        const bundle = ObjC.classes.NSBundle.mainBundle();
        const info = bundle.infoDictionary();
        const bundlePath = text(bundle.bundlePath());
        const executablePath = text(bundle.executablePath());
        const frameworks = listDirectory(`${bundlePath}/Frameworks`);
        const plugins = listDirectory(`${bundlePath}/PlugIns`);
        const loadedModules = Process.enumerateModules()
            .filter((module) => module.path.startsWith(bundlePath))
            .map((module) => ({ name: module.name, path: module.path }))
            .sort((left, right) => left.path.localeCompare(right.path));

        return {
            app: {
                name: infoValue(info, "CFBundleDisplayName") || infoValue(info, "CFBundleName"),
                bundle_id: infoValue(info, "CFBundleIdentifier"),
                version: infoValue(info, "CFBundleShortVersionString"),
                build: infoValue(info, "CFBundleVersion")
            },
            technologies: detectTechnologies(frameworks, loadedModules),
            inspection: {
                bundle_path: bundlePath,
                executable_path: executablePath,
                embedded_frameworks: frameworks,
                app_extensions: plugins,
                loaded_modules: loadedModules
            }
        };
    }
};
