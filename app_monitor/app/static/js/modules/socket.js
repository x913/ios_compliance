import { state } from './state.js';
import { UI } from './ui.js';
import { Dashboard } from './dashboard.js';

export const SocketClient = {
    init: () => {
        if (typeof io === 'undefined') {
            console.error("Socket.io library not found.");
            return;
        }

        try {
            const socket = io();
            state.socket = socket;
            
            socket.on('connect', () => UI.updateSocketStatus('🟢 Connected', 'text-success'));
            socket.on('disconnect', () => { 
                UI.updateSocketStatus('🔴 Disconnected', 'text-danger');
                UI.updateGlobalBar(false);
                state.currentMonitoredApp = null;
            });

            // [核心修复] 使用箭头函数包裹，防止 UI 方法未定义导致报错
            socket.on('network_log', (data) => {
                console.log("[Debug] Network Data:", data); // 方便调试
                if (UI && UI.renderNetworkLog) UI.renderNetworkLog(data);
                // 更新仪表盘
                Dashboard.updateNetwork(data.url);
            });

            socket.on('network_response_log', (data) => {
                console.log("[Debug] Network Response:", data);
                if (UI && UI.renderNetworkResponse) UI.renderNetworkResponse(data);
            });

            socket.on('file_log', (data) => {
                console.log("[Debug] File Data:", data);
                if (UI && UI.renderFileLog) UI.renderFileLog(data);
                // 更新计数
                Dashboard.updateFile()
            });

            socket.on('info_log', (data) => {
                console.log("[Debug] Info Data:", data);
                if (UI && UI.renderInfoLog) UI.renderInfoLog(data);
                // 更新仪表盘
                Dashboard.updatePrivacy(data.category);
            });

            socket.on('sdk_log', (payload) => {
                console.log("[Debug] SDK Data received:", payload);
                const list = payload.data || [];
                if (UI && UI.renderSDKList) UI.renderSDKList(list);
            });

            socket.on('sys_log', (data) => console.log("[System]", data.msg));

        } catch (e) {
            console.error("Socket init failed:", e);
        }
    }
};
