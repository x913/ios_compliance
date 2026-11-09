import { state } from './state.js';

const sdkCategoryLabels = {
    '基础能力类': 'Core capabilities',
    '辅助开发类': 'Developer tooling',
    '分享类': 'Sharing',
    '社交': 'Social',
    '三方登录类': 'Third-party sign-in',
    '第三方登录类': 'Third-party sign-in',
    '第三方登陆类': 'Third-party sign-in',
    '支付类': 'Payments',
    '统计类': 'Analytics',
    '数据分析类': 'Data analytics',
    '广告类': 'Advertising',
    '推送类': 'Push notifications',
    '地图导航类': 'Maps & navigation',
    '生活服务类': 'Lifestyle services',
    '身份认证类': 'Authentication',
    '安全风控类': 'Security & fraud prevention',
    '人脸识别类': 'Facial recognition',
    '音视频类': 'Audio & video',
    '即时通讯类': 'Instant messaging',
    '客服类': 'Customer support',
    'Crash监控类': 'Crash monitoring',
    '框架类': 'Framework',
    '用户画像类': 'User profiling'
};

function formatSdkCategory(category) {
    const rawCategory = Array.isArray(category) ? category.join(',') : (category || 'Other');
    return rawCategory
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => sdkCategoryLabels[value] || value)
        .join(', ') || 'Other';
}

const networkEntries = new Map();

function setNetworkResponseStatus(cell, response) {
    if (!cell) return;

    const badge = document.createElement('span');
    badge.className = 'badge';

    if (!response) {
        badge.classList.add('bg-secondary');
        badge.textContent = 'Pending';
    } else if (response.error) {
        badge.classList.add('bg-danger');
        badge.textContent = 'Error';
    } else if (response.status_code) {
        const status = Number(response.status_code);
        badge.classList.add(status >= 200 && status < 400 ? 'bg-success' : 'bg-warning', 'text-dark');
        badge.textContent = `HTTP ${response.status_code}`;
    } else {
        badge.classList.add('bg-info', 'text-dark');
        badge.textContent = 'Completed';
    }

    cell.replaceChildren(badge);
}

function formatNetworkDetails(request, response) {
    const lines = ['REQUEST', `${request.method || 'GET'} ${request.url || 'Unknown URL'}`];

    Object.entries(request.headers || {}).forEach(([key, value]) => lines.push(`${key}: ${value}`));
    lines.push('', 'BODY', request.body || '(No body)');

    lines.push('', 'RESPONSE');
    if (!response) {
        lines.push('Pending or unavailable (the task has no completion handler).');
        return lines.join('\n');
    }

    lines.push(response.status_code ? `HTTP ${response.status_code}` : 'Completed');
    if (response.url && response.url !== request.url) lines.push(response.url);
    Object.entries(response.headers || {}).forEach(([key, value]) => lines.push(`${key}: ${value}`));
    if (response.error) lines.push('', `ERROR: ${response.error}`);
    lines.push('', 'BODY', response.body || '(No body)');

    return lines.join('\n');
}

function showNetworkDetails(request, response) {
    if (!state.modals.stack) {
        const element = document.getElementById('stackModal');
        if (element) state.modals.stack = new bootstrap.Modal(element);
    }

    const titleEl = document.querySelector('#stackModal .modal-title');
    if (titleEl) titleEl.innerText = '🌐 Network Request & Response';

    const contentEl = document.getElementById('stackContent');
    if (contentEl) {
        contentEl.innerText = formatNetworkDetails(request, response);
        if (state.modals.stack) state.modals.stack.show();
    }
}

/**
 * UI 渲染与交互工具
 */
export const UI = {
    // === Modal 相关 ===
    initModals: () => {
        const globalEl = document.getElementById('globalModal');
        const stackEl = document.getElementById('stackModal');
        const configEl = document.getElementById('configModal');
        
        if (globalEl) state.modals.global = new bootstrap.Modal(globalEl);
        if (stackEl) state.modals.stack = new bootstrap.Modal(stackEl);
        if (configEl) state.modals.config = new bootstrap.Modal(configEl);
    },

    // [核心] 显示不可关闭的 Loading 弹框
    showLoadingModal: (title, message) => {
        // 如果实例不存在，尝试重新初始化
        if (!state.modals.global) {
            const el = document.getElementById('globalModal');
            if(el) state.modals.global = new bootstrap.Modal(el);
            else {
                console.error("找不到 globalModal 元素");
                return null;
            }
        }
        
        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalBody').innerHTML = `
            <div class="d-flex align-items-center">
                <div class="spinner-border text-primary me-3" role="status" style="width: 2rem; height: 2rem;"></div>
                <div class="fw-bold text-dark">${message.replace(/\n/g, '<br>')}</div>
            </div>
        `;
        document.getElementById('modalIcon').innerText = ''; 
        
        // 隐藏按钮
        document.getElementById('modalBtnConfirm').classList.add('d-none');
        document.getElementById('modalBtnCancel').classList.add('d-none');
        
        state.modals.global.show();
        return state.modals.global;
    },

    // ... (confirm, alert 等其他方法保持不变，请确保语法正确) ...
    confirm: (title, message, icon = '🤔', btnType = 'primary', confirmText = 'Confirm') => {
        return new Promise((resolve) => {
            if (!state.modals.global) { resolve(window.confirm(`${title}\n\n${message}`)); return; }
            document.getElementById('modalTitle').innerText = title;
            document.getElementById('modalBody').innerText = message;
            document.getElementById('modalIcon').innerText = icon;
            const confirmBtn = document.getElementById('modalBtnConfirm');
            confirmBtn.className = `btn btn-${btnType} rounded-pill px-4`;
            confirmBtn.innerText = confirmText;
            document.getElementById('modalBtnCancel').classList.remove('d-none');
            const handleConfirm = () => { cleanup(); state.modals.global.hide(); resolve(true); };
            const onHidden = () => { cleanup(); resolve(false); };
            const el = document.getElementById('globalModal');
            confirmBtn.addEventListener('click', handleConfirm);
            el.addEventListener('hidden.bs.modal', onHidden, { once: true });
            function cleanup() { confirmBtn.removeEventListener('click', handleConfirm); }
            state.modals.global.show();
        });
    },

    alert: (title, message, icon = 'ℹ️', btnType = 'primary') => {
        if (!state.modals.global) { window.alert(`${title}\n\n${message}`); return; }
        document.getElementById('modalTitle').innerText = title;
        document.getElementById('modalBody').innerText = message;
        document.getElementById('modalIcon').innerText = icon;
        const confirmBtn = document.getElementById('modalBtnConfirm');
        confirmBtn.className = `btn btn-${btnType} rounded-pill px-4`;
        confirmBtn.innerText = "Got it";
        document.getElementById('modalBtnCancel').classList.add('d-none');
        confirmBtn.onclick = () => state.modals.global.hide();
        state.modals.global.show();
    },

    showConfigModal: () => { if (state.modals.config) state.modals.config.show(); },
    hideConfigModal: () => { if (state.modals.config) state.modals.config.hide(); },

    updateSocketStatus: (text, colorClass) => {
        const el = document.getElementById('socket-status');
        if (el) {
            el.innerText = text;
            el.className = `badge bg-secondary ${colorClass}`;
            if (colorClass === 'text-success') el.classList.replace('bg-secondary', 'bg-dark');
        }
    },

    updateGlobalBar: (visible, appName = '', mode = '') => {
        const bar = document.getElementById('global-monitor-bar');
        const nameEl = document.getElementById('global-app-name');
        if (visible) {
            if(appName) nameEl.innerText = `${appName} ${mode ? '('+mode+')' : ''}`;
            bar.classList.remove('d-none'); bar.classList.add('d-flex');
        } else {
            bar.classList.remove('d-flex'); bar.classList.add('d-none');
        }
    },

    activateTab: (targetSelector) => {
        const tabEl = document.querySelector(`button[data-bs-target="${targetSelector}"]`);
        if (tabEl) new bootstrap.Tab(tabEl).show();
    },

    // === 日志渲染 ===
    renderNetworkLog: (data) => {
        const tbody = document.getElementById('netLogBody');
        if (!tbody) return;

        const requestId = data.request_id || `request-${Date.now()}-${networkEntries.size}`;
        const request = { ...data, request_id: requestId };
        networkEntries.set(requestId, { request, response: null });

        const tr = document.createElement('tr');
        tr.dataset.requestId = requestId;
        let methodColor = data.method === 'GET' ? 'text-success' : 'text-primary';
        if (data.method === 'POST') methodColor = 'text-warning fw-bold';

        tr.innerHTML = `
            <td class="text-muted font-monospace align-middle">${data.timestamp}</td>
            <td class="fw-bold ${methodColor} align-middle">${data.method}</td>
            <td class="text-break font-monospace small align-middle">${data.url}</td>
            <td id="network-response-${requestId}" class="text-center align-middle"></td>
            <td class="text-center align-middle">
                <button class="btn btn-xs btn-outline-secondary py-0" style="font-size: 11px;" 
                        onclick="window.showNetworkDetailById('${requestId}')">Details</button>
            </td>
        `;
        tbody.prepend(tr);
        setNetworkResponseStatus(document.getElementById(`network-response-${requestId}`), null);

        if (tbody.children.length > 500) {
            const removed = tbody.lastElementChild;
            networkEntries.delete(removed.dataset.requestId);
            removed.remove();
        }
    },

    renderNetworkResponse: (data) => {
        const entry = networkEntries.get(data.request_id);
        if (!entry) {
            console.warn('[Network] Received a response without its request:', data.request_id);
            return;
        }

        entry.response = data;
        setNetworkResponseStatus(
            document.getElementById(`network-response-${data.request_id}`),
            data
        );
    },

    // 渲染信息采集日志
    renderInfoLog: (data) => {
        const tbody = document.getElementById('infoLogBody');
        if (!tbody) return;

        const tr = document.createElement('tr');
        const timestamp = data.timestamp || new Date().toLocaleTimeString('en-GB', { hour12: false });
        const category = data.category || 'Info';
        const func = data.func || '-';
        const method = data.method || '';
        const content = data.content || '';
        const stack = data.stack || 'No stack trace available';

        let badgeClass = 'bg-secondary text-secondary';
        const catLower = category.toLowerCase();
        
        if (catLower.includes('idfa')) badgeClass = 'bg-primary bg-opacity-10 text-primary border border-primary';
        else if (catLower.includes('idfv')) badgeClass = 'bg-info bg-opacity-10 text-info border border-info';
        else if (catLower.includes('pasteboard') || catLower.includes('剪贴板')) badgeClass = 'bg-danger bg-opacity-10 text-danger border border-danger';
        else if (catLower.includes('location')) badgeClass = 'bg-warning bg-opacity-10 text-warning border border-warning';
        else if (catLower.includes('photolibrary')) badgeClass = 'bg-success bg-opacity-10 text-success border border-success';
        else if (catLower.includes('contacts')) badgeClass = 'bg-dark bg-opacity-10 text-dark border border-dark';
        else badgeClass = 'bg-dark bg-opacity-10 text-dark border border-dark';

        const safeStack = encodeURIComponent(stack);

        tr.innerHTML = `
            <td class="text-muted font-monospace align-middle py-2">${timestamp}</td>
            <td class="align-middle py-2"><span class="badge ${badgeClass}">${category}</span></td>
            <td class="fw-bold text-dark font-monospace align-middle text-break py-2">${func}</td>
            <td class="text-secondary small align-middle py-2">${method}</td>
            <td class="font-monospace text-dark align-middle text-break fw-bold py-2" style="font-size: 11px;">${content}</td>
            <td class="text-center align-middle py-2">
                <button class="btn btn-sm btn-outline-secondary py-0" style="font-size: 12px;" onclick="window.showStackTrace('${safeStack}')">View</button>
            </td>
        `;
        tbody.prepend(tr);
        if (tbody.children.length > 500) tbody.lastElementChild.remove();
    },

    // 渲染文件日志
    renderFileLog: (data) => {
        const tbody = document.getElementById('fileLogBody');
        if (!tbody) return;
        
        const tr = document.createElement('tr');
        const op = data.op || 'Unknown';
        const stack = data.stack || 'No stack trace available';

        let opBadge = op.includes('Delete')
            ? '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger">Delete</span>'
            : `<span class="badge bg-success bg-opacity-10 text-success border border-success">${op}</span>`;

        const safeStack = encodeURIComponent(stack);
        
        tr.innerHTML = `
            <td class="text-muted font-monospace align-middle py-2">${data.timestamp}</td>
            <td class="fw-bold text-primary font-monospace align-middle py-2">${data.func}</td>
            <td class="align-middle py-2">${opBadge}</td>
            <td class="text-break font-monospace small align-middle py-2" style="word-break: break-all;">${data.method}</td>
            <td class="text-center align-middle py-2">
                <button class="btn btn-sm btn-outline-secondary py-0" style="font-size: 12px;" onclick="window.showStackTrace('${safeStack}')">Details</button>
            </td>
        `;
        
        tbody.prepend(tr);
        if (tbody.children.length > 500) tbody.lastElementChild.remove();
    },

    renderAppList: (apps) => {
        const tbody = document.getElementById('appTableBody');
        if (!apps || apps.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="p-0 border-0"><div class="d-flex flex-column align-items-center justify-content-center text-muted" style="height: calc(100vh - 200px);"><h5 class="fw-light">No applications found</h5></div></td></tr>';
            return;
        }
        tbody.innerHTML = apps.map(app => {
            const icon = app.icon 
                ? `<img src="data:image/png;base64,${app.icon}" class="app-icon shadow-sm" style="width:40px;height:40px;border-radius:10px;">` 
                : `<div style="width:40px;height:40px;background:#eee;border-radius:10px;"></div>`;
            const safeName = app.name.replace(/'/g, "\\'");
            const safeBundleId = app.bundle_id.replace(/'/g, "\\'");
            const safeVersion = app.version.replace(/'/g, "\\'");
            return `<tr>
                <td class="text-center">${icon}</td>
                <td class="fw-bold">${app.name}</td>
                <td class="font-monospace small text-muted">${app.bundle_id}</td>
                <td><span class="badge bg-light text-dark border">${app.version}</span></td>
                <td class="text-end pe-4">
                    <div class="d-inline-flex gap-2">
                        <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="window.analyzeApp('${safeName}', '${safeBundleId}', '${safeVersion}')">🔬 Analyze</button>
                        <button class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="window.handleMonitor('${safeName}', '${safeBundleId}')">📡 Start monitoring</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    },

    renderSDKList: (sdkList) => {
        const tbody = document.getElementById('sdk-table-body');
        const countBadge = document.getElementById('sdk-count');
        if (!tbody) return;

        if (!sdkList || sdkList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-muted">No known SDKs detected</td></tr>`;
            if(countBadge) {
                countBadge.innerText = `${sdkList.length} detected`;
                countBadge.className = 'badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary px-3 py-2';
            }
            return;
        }

        if(countBadge) countBadge.innerText = `${sdkList.length} detected`;

        let html = '';
        sdkList.forEach((item) => {
            const matchHtml = `<code class="text-primary bg-light px-1 rounded">${item.match}</code>`;
            const displayCategory = formatSdkCategory(item.category);
            let catColor = 'text-secondary';
            if (item.category.includes('基础') || item.category.includes('工具')) catColor = 'text-info';
            else if (item.category.includes('分享') || item.category.includes('社交')) catColor = 'text-success';
            else if (item.category.includes('地图') || item.category.includes('定位')) catColor = 'text-warning';
            else if (item.category.includes('广告') || item.category.includes('推送')) catColor = 'text-danger';

            html += `
                <tr>
                    <td class="ps-4 fw-bold text-dark">${item.name}</td>
                    <td class="${catColor} small">${displayCategory}</td>
                    <td class="small font-monospace text-break">${matchHtml}</td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    },

    // 插件加载失败重置 SDK 列表状态
    resetSDKTable: (state = 'default') => {
        const tbody = document.getElementById('sdk-table-body');
        const countBadge = document.getElementById('sdk-count');
        
        if (!tbody) return;

        if (state === 'loading') {
            // 状态：分析中
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-4 text-muted">
                        <span class="spinner-border spinner-border-sm me-2"></span>
                        Analyzing memory and dynamic-library signatures...
                    </td>
                </tr>
            `;
            if (countBadge) {
                countBadge.innerText = 'Analyzing...';
                countBadge.className = 'badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary px-3 py-2';
            }
        } else {
            // 状态：恢复初始/失败
            tbody.innerHTML = `
                <tr>
                    <td colspan="3" class="text-center py-4 text-muted">
                        <i class="bi bi-pause-circle me-1"></i> Waiting for monitoring to start
                    </td>
                </tr>
            `;
            if (countBadge) {
                countBadge.innerText = 'Waiting for analysis...';
                countBadge.className = 'badge rounded-pill bg-primary bg-opacity-10 text-primary border border-primary px-3 py-2';
            }
        }
    },

    clearAllLogs: () => {
        networkEntries.clear();
        ['netLogBody', 'fileLogBody', 'infoLogBody'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
        // 调用设置 SDK清单 状态
        UI.resetSDKTable('loading'); 
    },

    // 显示堆栈详情 (Modal)
    showStackTrace: (encodedStack) => {
        // 使用 state 中的缓存，如果没有则重新获取
        if (!state.modals.stack) {
            const el = document.getElementById('stackModal');
            if (el) state.modals.stack = new bootstrap.Modal(el);
        }

        const stackStr = decodeURIComponent(encodedStack);
        const contentEl = document.getElementById('stackContent');
        const titleEl = document.querySelector('#stackModal .modal-title');

        if (titleEl) titleEl.innerText = "📜 Call Stack";

        if (contentEl) {
            contentEl.innerHTML = stackStr;
            if (state.modals.stack) state.modals.stack.show();
        }
    },

    showNetworkDetailById: (requestId) => {
        const entry = networkEntries.get(requestId);
        if (!entry) {
            UI.alert('Network entry unavailable', 'The selected request is no longer in the log.', '⚠️', 'warning');
            return;
        }
        showNetworkDetails(entry.request, entry.response);
    },

    // Kept for compatibility with existing inline calls.
    showNetworkDetail: (encodedData) => {
        let data;
        try {
            data = JSON.parse(decodeURIComponent(encodedData));
        } catch (e) {
            return alert("Could not parse request data.");
        }
        showNetworkDetails(data, data.response || null);
    }
};
