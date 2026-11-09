import { UI } from './modules/ui.js';
import { SocketClient } from './modules/socket.js';
import { Actions } from './modules/actions.js';
import { Dashboard } from './modules/dashboard.js';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化 UI
    UI.initModals();
    Dashboard.init();
    SocketClient.init();

    // 2. 绑定刷新按钮
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', Actions.refreshApps);
    }

    // 3. 绑定配置框切换
    document.querySelectorAll('input[name="monitorMode"]').forEach(el => {
        el.addEventListener('change', (e) => {
            const tweakDiv = document.getElementById('tweakSettings');
            if (e.target.id === 'modeTweak') tweakDiv.classList.remove('d-none');
            else tweakDiv.classList.add('d-none');
        });
    });

    // 4. 初始化搜索
    setupFilters();
});

// ============================================================
// 全局导出函数 (供 HTML onclick 调用)
// ============================================================

window.handleMonitor = Actions.handleMonitor;
window.confirmConfig = Actions.confirmConfig;
window.stopMonitor = Actions.stopMonitor;
window.clearNetLogs = UI.clearAllLogs; 
window.clearFileLogs = UI.clearAllLogs;
window.clearInfoLogs = UI.clearAllLogs;

// [核心修复] 直接挂载 UI 模块的方法
window.showStackTrace = UI.showStackTrace;
window.showNetworkDetail = UI.showNetworkDetail;
window.showNetworkDetailById = UI.showNetworkDetailById;

// [辅助] 挂载行内展开 (如果你的UI还在用的话，虽然这里UI.js里用的是showStackTrace)
window.toggleStackCell = (uid) => {
    const btn = document.getElementById(`stack-btn-${uid}`);
    const content = document.getElementById(`stack-content-${uid}`);
    if (btn && content) {
        const isHidden = content.classList.contains('d-none');
        content.classList.toggle('d-none', !isHidden);
        btn.classList.toggle('d-none', isHidden);
    }
};

// 搜索 Helper
function setupFilters() {
    function setup(inputId, tbodyId, indices) {
        const input = document.getElementById(inputId);
        const tbody = document.getElementById(tbodyId);
        if(!input || !tbody) return;
        input.addEventListener('input', function() {
            const term = this.value.toLowerCase().trim();
            for(let row of tbody.getElementsByTagName('tr')) {
                if(!term) { row.style.display = ''; continue; }
                let match = false;
                const cells = row.getElementsByTagName('td');
                for(let idx of indices) {
                    if(cells[idx] && cells[idx].innerText.toLowerCase().includes(term)) { match = true; break; }
                }
                row.style.display = match ? '' : 'none';
            }
        });
    }
    setup('netSearch', 'netLogBody', [1, 2]);
    setup('fileSearch', 'fileLogBody', [1, 2, 3]);
    setup('infoSearch', 'infoLogBody', [1, 2, 3]);
}
