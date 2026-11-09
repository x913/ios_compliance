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
const MAX_VIEWABLE_FILE_BYTES = 1024 * 1024;
const IMAGE_MIME_TYPES = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp"
};
const TEXT_EXTENSIONS = new Set([
    "txt", "json", "xml", "html", "htm", "js", "mjs", "css", "svg", "yaml", "yml",
    "strings", "md", "csv", "ini", "conf", "plist", "swift", "m", "mm", "h", "c", "cpp"
]);

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

function extensionForPath(path) {
    const name = path.split("/").pop() || "";
    const separator = name.lastIndexOf(".");
    return separator >= 0 ? name.slice(separator + 1).toLowerCase() : "";
}

function fileAttributes(path) {
    return ObjC.classes.NSFileManager.defaultManager().attributesOfItemAtPath_error_(path, NULL);
}

function safeBundleRelativePath(value) {
    const relativePath = String(value || "");
    if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\\0")) {
        throw new Error("A bundle-relative file path is required");
    }

    const components = relativePath.split("/");
    if (components.some((component) => !component || component === "." || component === "..")) {
        throw new Error("The requested path is outside the app bundle");
    }
    return relativePath;
}

function dataAsUtf8(data) {
    const string = ObjC.classes.NSString.alloc().initWithData_encoding_(data, 4);
    if (!string) throw new Error("The file is not valid UTF-8 text");
    return text(string);
}

function readPropertyList(path) {
    const dictionary = ObjC.classes.NSDictionary.dictionaryWithContentsOfFile_(path);
    if (!dictionary) throw new Error("The property list could not be decoded");

    const data = ObjC.classes.NSJSONSerialization.dataWithJSONObject_options_error_(dictionary, 1, NULL);
    if (!data) throw new Error("The property list cannot be represented as JSON");
    return JSON.parse(dataAsUtf8(data));
}

function readPrefix(path, length = 4096) {
    const handle = ObjC.classes.NSFileHandle.fileHandleForReadingAtPath_(path);
    if (!handle) return [];

    try {
        const data = handle.readDataOfLength_(length);
        const dataLength = Number(data.length());
        const bytes = [];
        const pointer = data.bytes();
        for (let index = 0; index < dataLength; index += 1) {
            bytes.push(pointer.add(index).readU8());
        }
        return bytes;
    } finally {
        handle.closeFile();
    }
}

function readUInt32(bytes, offset, littleEndian) {
    if (bytes.length < offset + 4) return null;
    if (littleEndian) {
        return (bytes[offset]
            + (bytes[offset + 1] * 0x100)
            + (bytes[offset + 2] * 0x10000)
            + (bytes[offset + 3] * 0x1000000)) >>> 0;
    }
    return ((bytes[offset] * 0x1000000)
        + (bytes[offset + 1] * 0x10000)
        + (bytes[offset + 2] * 0x100)
        + bytes[offset + 3]) >>> 0;
}

function cpuName(cpuType) {
    const names = {
        7: "x86",
        12: "arm",
        18: "ppc",
        0x01000007: "x86_64",
        0x0100000c: "arm64",
        0x01000012: "ppc64"
    };
    return names[cpuType] || `CPU type 0x${cpuType.toString(16)}`;
}

function machOMetadata(path) {
    try {
        const bytes = readPrefix(path);
        if (bytes.length < 4) return null;
        const magic = bytes.slice(0, 4).map((byte) => byte.toString(16).padStart(2, "0")).join("");

        const thinFormats = {
            cffaedfe: { name: "Mach-O 64-bit", littleEndian: true },
            cefaedfe: { name: "Mach-O 32-bit", littleEndian: true },
            feedfacf: { name: "Mach-O 64-bit", littleEndian: false },
            feedface: { name: "Mach-O 32-bit", littleEndian: false }
        };
        const thin = thinFormats[magic];
        if (thin) {
            const cpuType = readUInt32(bytes, 4, thin.littleEndian);
            return {
                format: thin.name,
                architectures: cpuType === null ? [] : [cpuName(cpuType)]
            };
        }

        const isFat = magic === "cafebabe" || magic === "cafebabf";
        if (!isFat) return null;

        const architectureCount = Math.min(readUInt32(bytes, 4, false) || 0, 8);
        const entrySize = magic === "cafebabf" ? 32 : 20;
        const architectures = [];
        for (let index = 0; index < architectureCount; index += 1) {
            const cpuType = readUInt32(bytes, 8 + index * entrySize, false);
            if (cpuType !== null) architectures.push(cpuName(cpuType));
        }
        return {
            format: "Universal (fat) Mach-O",
            architectures: Array.from(new Set(architectures))
        };
    } catch (_) {
        return null;
    }
}

function inspectBundleFile(bundlePath, relativePath) {
    const safePath = safeBundleRelativePath(relativePath);
    const fullPath = `${bundlePath}/${safePath}`;
    const attributes = fileAttributes(fullPath);
    if (!attributes || text(attributes.objectForKey_("NSFileType")) !== "NSFileTypeRegular") {
        throw new Error("The selected item is not a regular file in the app bundle");
    }

    const size = numberValue(attributes.objectForKey_("NSFileSize"));
    const extension = extensionForPath(safePath);
    const result = {
        path: safePath,
        size,
        extension,
        mach_o: machOMetadata(fullPath)
    };

    if (size > MAX_VIEWABLE_FILE_BYTES) {
        return {
            ...result,
            viewer_type: "binary",
            message: `Preview is limited to ${MAX_VIEWABLE_FILE_BYTES} bytes; this file is ${size} bytes.`
        };
    }

    if (extension === "plist") {
        return {
            ...result,
            viewer_type: "text",
            language: "json",
            content: JSON.stringify(readPropertyList(fullPath), null, 2)
        };
    }

    const data = ObjC.classes.NSData.dataWithContentsOfFile_(fullPath);
    if (!data) throw new Error("The file could not be read from the app bundle");

    if (IMAGE_MIME_TYPES[extension]) {
        return {
            ...result,
            viewer_type: "image",
            mime_type: IMAGE_MIME_TYPES[extension],
            content_base64: text(data.base64EncodedStringWithOptions_(0))
        };
    }

    if (TEXT_EXTENSIONS.has(extension)) {
        return {
            ...result,
            viewer_type: "text",
            language: extension,
            content: dataAsUtf8(data)
        };
    }

    return {
        ...result,
        viewer_type: "binary",
        message: result.mach_o
            ? "Binary Mach-O metadata is available below."
            : "This binary format is not previewed as text."
    };
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

        let infoPlist = null;
        let infoPlistError = "";
        try {
            infoPlist = readPropertyList(`${bundlePath}/Info.plist`);
        } catch (error) {
            infoPlistError = `Info.plist could not be decoded: ${error}`;
        }

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
                file_inventory: fileInventory,
                info_plist: infoPlist,
                info_plist_error: infoPlistError
            }
        };
    },

    readFile(relativePath) {
        if (!ObjC.available) throw new Error("Objective-C runtime is not available in the target process");
        const bundlePath = text(ObjC.classes.NSBundle.mainBundle().bundlePath());
        return inspectBundleFile(bundlePath, relativePath);
    }
};
