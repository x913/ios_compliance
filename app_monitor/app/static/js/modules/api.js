/**
 * 后端 API 接口封装
 */
const BASE_URL = '/api';

async function post(endpoint, data = {}) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return await res.json();
}

async function get(endpoint) {
    const res = await fetch(`${BASE_URL}${endpoint}`);
    return await res.json();
}

export const API = {
    fetchApps: () => get('/apps'),

    analyzeApp: (bundleId) => post('/analyze_app', { bundle_id: bundleId }),

    viewBundleFile: (bundleId, relativePath) => post('/view_bundle_file', {
        bundle_id: bundleId,
        relative_path: relativePath
    }),

    getDumpToolStatus: () => get('/dump_tool_status'),

    dumpIPA: (bundleId, appName) => post('/dump_ipa', {
        bundle_id: bundleId,
        app_name: appName
    }),
    
    startMonitor: (bundleId) => post('/start_monitor', { bundle_id: bundleId }),
    
    startTweakMonitor: (bundleId, deviceIp, serverIp) => post('/start_tweak_monitor', {
        bundle_id: bundleId,
        device_ip: deviceIp,
        server_ip: serverIp
    }),
    
    stopMonitor: () => post('/stop_monitor'),
    
    stopTweakMonitor: (deviceIp, bundleId) => post('/stop_tweak_monitor', { device_ip: deviceIp, bundle_id: bundleId})
};
