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

const MAX_FILE_INDEX_ENTRIES = 500;
const MAX_LARGEST_FILES = 30;
const MAX_TECHNOLOGY_FILES = 100;

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

function numberValue(value) {
    const parsed = Number(text(value, "0"));
    return Number.isFinite(parsed) ? parsed : 0;
}

function fileCategory(relativePath, executableRelativePath) {
    if (relativePath === executableRelativePath) return "executable";
    if (relativePath.startsWith("Frameworks/")) return "frameworks";
    if (relativePath.startsWith("PlugIns/")) return "extensions";
    return "resources";
}

function inventoryBundle(bundlePath, executablePath) {
    const result = {
        total_bytes: 0,
        file_count: 0,
        size_breakdown: { executable: 0, frameworks: 0, extensions: 0, resources: 0 },
        largest_files: [],
        files: [],
        indexed_file_count: 0,
        top_level_entries: listDirectory(bundlePath)
    };

    try {
        const manager = ObjC.classes.NSFileManager.defaultManager();
        const enumerator = manager.enumeratorAtPath_(bundlePath);
        const executableRelativePath = executablePath.startsWith(`${bundlePath}/`)
            ? executablePath.slice(bundlePath.length + 1)
            : "";
        const allFiles = [];

        while (true) {
            const item = enumerator.nextObject();
            if (!item) break;

            const relativePath = text(item);
            const attributes = manager.attributesOfItemAtPath_error_(`${bundlePath}/${relativePath}`, NULL);
            if (!attributes || text(attributes.objectForKey_("NSFileType")) !== "NSFileTypeRegular") continue;

            const size = numberValue(attributes.objectForKey_("NSFileSize"));
            const category = fileCategory(relativePath, executableRelativePath);
            const file = { path: relativePath, size, category };
            allFiles.push(file);
            result.total_bytes += size;
            result.file_count += 1;
            result.size_breakdown[category] += size;
        }

        result.largest_files = allFiles
            .slice()
            .sort((left, right) => right.size - left.size)
            .slice(0, MAX_LARGEST_FILES);
        result.files = allFiles
            .slice()
            .sort((left, right) => left.path.localeCompare(right.path))
            .slice(0, MAX_FILE_INDEX_ENTRIES);
        result.indexed_file_count = result.files.length;
        result._all_files = allFiles;
    } catch (error) {
        result.error = `File inventory failed: ${error}`;
        result._all_files = [];
    }

    return result;
}

function technologyFiles(files) {
    const markers = [];
    TECHNOLOGY_RULES.forEach((rule) => rule.markers.forEach((marker) => markers.push(marker)));
    return files
        .filter((file) => markers.some((marker) => file.path.includes(marker)))
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, MAX_TECHNOLOGY_FILES);
}

function detectTechnologies(frameworks, modules, files) {
    const haystack = frameworks
        .concat(modules.map((module) => module.path))
        .concat(files.map((file) => file.path));
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
        const fileInventory = inventoryBundle(bundlePath, executablePath);
        const allFiles = fileInventory._all_files;
        delete fileInventory._all_files;
        fileInventory.technology_files = technologyFiles(allFiles);

        return {
            app: {
                name: infoValue(info, "CFBundleDisplayName") || infoValue(info, "CFBundleName"),
                bundle_id: infoValue(info, "CFBundleIdentifier"),
                version: infoValue(info, "CFBundleShortVersionString"),
                build: infoValue(info, "CFBundleVersion")
            },
            technologies: detectTechnologies(frameworks, loadedModules, allFiles),
            inspection: {
                bundle_path: bundlePath,
                executable_path: executablePath,
                embedded_frameworks: frameworks,
                app_extensions: plugins,
                loaded_modules: loadedModules,
                file_inventory: fileInventory
            }
        };
    }
};
