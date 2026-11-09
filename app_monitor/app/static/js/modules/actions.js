import { state } from './state.js';
import { API } from './api.js';
import { UI } from './ui.js';
import { Dashboard } from './dashboard.js';

export const Actions = {
    // 点击“开启监控”
    handleMonitor: async (appName, bundleId) => {
        if (!state.socket) return UI.alert("Error", "Socket is not connected.", "❌", "danger");

        // 切换或重启判断
        if (state.currentMonitoredApp) {
            if (state.currentMonitoredApp.bundleId !== bundleId) {
                if (!(await UI.confirm("Switch application", `Stop [${state.currentMonitoredApp.name}] and start [${appName}]?`, "🔀", "primary", "Switch"))) return;
            } else {
                if (!(await UI.confirm("Restart monitoring", `Restart monitoring for [${appName}]?`, "🔄", "warning", "Restart"))) return;
            }
        }

        // 暂存并打开配置
        state.pendingApp = { name: appName, bundleId: bundleId };
        UI.showConfigModal();
    },

    // 确认配置并启动
    confirmConfig: async () => {
        const mode = document.getElementById('modeTweak').checked ? 'tweak' : 'frida';
        const deviceIp = document.getElementById('deviceIp').value;
        const serverIp = document.getElementById('serverIp').value;

        if (mode === 'tweak' && (!deviceIp || !serverIp)) {
            alert("Both IP addresses are required in Tweak mode.");
            return;
        }

        UI.hideConfigModal();
        await Actions.startProcess(mode, state.pendingApp.name, state.pendingApp.bundleId, deviceIp, serverIp);
    },

    // 启动监控
    startProcess: async (mode, appName, bundleId, deviceIp, serverIp) => {
        // 初始化 UI
        UI.activateTab('#info-collection');
        UI.updateGlobalBar(true, appName, 'Starting');
        UI.clearAllLogs();
        Dashboard.clear();

        // 根据模式显示不同的 Loading 提示文案
        let loadingTitle, loadingMsg;
        
        if (mode === 'tweak') {
            loadingTitle = "Deploying Tweak";
            loadingMsg = "Uploading and validating files over SSH...\nKeep the network connection active.";
        } else {
            loadingTitle = "Starting Frida";
            loadingMsg = "Connecting over USB and injecting scripts...\nKeep the device unlocked.";
        }

        // 显示 Loading
        UI.showLoadingModal(loadingTitle, loadingMsg);
        // 定义强制关闭 Loading
        const forceHideLoading = () => {
            const el = document.getElementById('globalModal');
            if (el) {
                const modal = bootstrap.Modal.getInstance(el); 
                if (modal) setTimeout(() => modal.hide(), 300); // 延时关闭防止动画冲突
            }
        };

        try {
            // 准备请求
            let res;
            if (mode === 'tweak') {
                res = await API.startTweakMonitor(bundleId, deviceIp, serverIp);
            } else {
                res = await API.startMonitor(bundleId);
            }
            if (res.status === 'success') {
                // 关闭部署 Loading
                forceHideLoading();
                if (mode === 'tweak') {
                    // Tweak 模式：进入等待心跳阶段
                    await Actions.waitForTweakInjection(appName, bundleId, deviceIp);
                } else {
                    // Frida 模式：直接成功
                    UI.updateGlobalBar(true, appName, 'Frida');
                    state.currentMonitoredApp = { name: appName, bundleId, mode, deviceIp };
                }
            } else {
                throw new Error(res.message);
            }
        } catch (e) {
            // 统一错误处理
            forceHideLoading();
            UI.updateGlobalBar(false);
            // 启动失败，将 SDK 列表恢复到初始状态
            UI.resetSDKTable('default');
            state.currentMonitoredApp = null;
            // 优化错误提示
            let errMsg = e.message;
            if (e.message.includes("Failed to spawn")) {
                errMsg = "Unable to start the app. Check:\n1. The device is unlocked\n2. The target app is installed\n3. No other Frida process conflicts";
            }
            
            UI.alert("Failed to start", errMsg, "❌", "danger");
        }
    },

    // 等待 Tweak 心跳信号
    waitForTweakInjection: (appName, bundleId, deviceIp) => {
        return new Promise((resolve) => {
            const timeoutSeconds = 15;
            let isReceived = false;
            // 临时监听器
            const onHeartLog = (data) => {
                if (data.msg && (data.msg.includes("Heartbeat") || data.msg.includes("HeartBeat"))) {
                    isReceived = true;
                    cleanup();
                    // 成功逻辑
                    UI.updateGlobalBar(true, appName, 'Tweak');
                    state.currentMonitoredApp = { name: appName, bundleId, mode: 'tweak', deviceIp };
                    resolve(true);
                }
            };

            if (state.socket) state.socket.on('heart_log', onHeartLog);

            const cleanup = () => {
                if (state.socket) state.socket.off('heart_log', onHeartLog);
                clearInterval(timer);
            };

            // 倒计时
            let timeLeft = timeoutSeconds;
            const timer = setInterval(() => {
                timeLeft--;
                if (timeLeft <= 0) {
                    cleanup();
                    if (!isReceived) {
                        // 等待超时，提示用户进行修改
                        UI.updateGlobalBar(true, appName, 'Tweak inactive');
                        state.currentMonitoredApp = { name: appName, bundleId, mode: 'tweak', deviceIp };
                        
                        UI.alert(
                            "Timed out waiting",
                            "The Tweak was deployed, but no successful-load heartbeat was received.\n\nTry the following before starting monitoring again:\n1. Check the Local Network permission\nSettings → target app → enable Local Network.\n2. Check wireless-data permission\nSettings → target app → allow Wi-Fi and Cellular Data.\n3. Check VPNs and proxies\nTurn off all VPN and proxy apps, then retry on a clean network connection.",
                            "⚠️", "warning"
                        );
                        resolve(false);
                        // 启动失败，将 SDK 列表恢复到初始状态
                        UI.resetSDKTable('default');
                    }
                }
            }, 1000);
        });
    },

    // 停止监控
    stopMonitor: async () => {
        if (!state.currentMonitoredApp) return;
        // 根据模式区分提示文案
        const msg = state.currentMonitoredApp.mode === 'tweak' 
            ? "Stop the current monitoring session?\nThe target app will be closed. Keep SSH connected so the injected Tweak can be removed."
            : "Stop the current monitoring session?\nThe target app will be closed to remove the injected script.";

        if (!(await UI.confirm("Stop monitoring", msg, "🛑", "danger", "Stop"))) return;
        
        const { mode, deviceIp, bundleId } = state.currentMonitoredApp;

        try {
            if (mode === 'tweak') {
                await API.stopTweakMonitor(deviceIp, bundleId);
            } else {
                await API.stopMonitor();
            }
        } catch (e) {
            console.error("[stopMonitor] 发生错误:", e.message);
            UI.alert("Notice", "Could not send the stop command: " + e.message, "⚠️", "warning");
        } finally {
            // 无论成功失败，强制重置 UI
            state.currentMonitoredApp = null;
            UI.updateGlobalBar(false);
        }
    },

    // 刷新应用列表
    refreshApps: async () => {
        const btn = document.getElementById('refreshBtn');
        if (!btn) return;
        
        btn.disabled = true;
        // 显示加载占位
        const tbody = document.getElementById('appTableBody');
        tbody.innerHTML = `<tr><td colspan="5" class="p-0 border-0"><div class="d-flex flex-column align-items-center justify-content-center text-muted" style="height: calc(100vh - 200px);"><div class="spinner-border text-primary mb-3"></div><p>Fetching applications from the device...</p></div></td></tr>`;

        try {
            const res = await API.fetchApps();
            if (res.status === 'error') throw new Error(res.message);
            UI.renderAppList(res.data);
        } catch (e) {
            UI.alert("Failed to fetch applications", e.message, "❌", "danger");
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-5 text-danger">Failed to retrieve applications</td></tr>`;
        } finally {
            btn.disabled = false;
        }
    }
};
