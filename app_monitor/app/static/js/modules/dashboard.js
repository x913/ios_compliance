/**
 * Dashboard Module - 数据统计与图表渲染
 */

const stats = {
    privacy: {},   
    domains: {},   
    webview: [],
    total: { privacy: 0, network: 0, file: 0 }
};

let charts = {
    privacy: null,
    network: null
};

// 初始化图表
function init() {
    const ctxPrivacy = document.getElementById('privacyChart');
    const ctxNetwork = document.getElementById('networkChart');

    // [新增] 注册数据标签插件
    if (typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    // 1. 隐私合规环形图
    if (ctxPrivacy) {
        charts.privacy = new Chart(ctxPrivacy, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#dc3545', 
                        '#fd7e14', '#ffc107', '#198754', '#20c997', '#0dcaf0'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    // [新增] 数据标签配置 (显示百分比)
                    datalabels: {
                        color: '#fff', // 文字颜色
                        font: { weight: 'bold', size: 12 },
                        formatter: (value, ctx) => {
                            let sum = 0;
                            let dataArr = ctx.chart.data.datasets[0].data;
                            dataArr.map(data => { sum += data; });
                            // 计算百分比
                            let percentage = (value * 100 / sum).toFixed(1) + "%";
                            return percentage;
                        },
                        // 数值太小或为0时不显示
                        display: function(context) {
                            return context.dataset.data[context.dataIndex] > 0;
                        }
                    },
                    // [新增] 图例配置 (显示次数)
                    legend: { 
                        position: 'right',
                        labels: {
                            // 自定义生成图例标签
                            generateLabels: function(chart) {
                                const data = chart.data;
                                if (data.labels.length && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const meta = chart.getDatasetMeta(0);
                                        const ds = data.datasets[0];
                                        const value = ds.data[i]; // 获取次数
                                        const hidden = meta.data[i].hidden;

                                        // 返回自定义对象
                                        return {
                                            text: `${label}: ${value} events`, // [核心修改] 拼接次数
                                            fillStyle: ds.backgroundColor[i],
                                            strokeStyle: ds.backgroundColor[i],
                                            lineWidth: 1,
                                            hidden: isNaN(value) || hidden,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    }
                }
            }
        });
    }

    // 2. 网络请求柱状图 (不需要百分比插件，这里禁用掉)
    if (ctxNetwork) {
        charts.network = new Chart(ctxNetwork, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Requests',
                    data: [],
                    backgroundColor: 'rgba(25, 135, 84, 0.6)',
                    borderColor: 'rgba(25, 135, 84, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } },
                plugins: {
                    // 在柱状图中禁用 datalabels 插件，保持界面整洁
                    datalabels: { display: false } 
                }
            }
        });
    }

    renderEmptyWebViewState();
}

function renderEmptyWebViewState() {
    const list = document.getElementById('webviewUrlList');
    const count = document.getElementById('webview-count');
    if (count) count.innerText = '0 captured';
    if (list) {
        list.innerHTML = '<li class="list-group-item text-center text-muted small py-4">No WebView navigation captured yet</li>';
    }
}

// 更新隐私统计
function updatePrivacy(category) {
    stats.total.privacy++;
    const el = document.getElementById('count-privacy');
    if(el) el.innerText = stats.total.privacy;

    stats.privacy[category] = (stats.privacy[category] || 0) + 1;

    if (charts.privacy) {
        charts.privacy.data.labels = Object.keys(stats.privacy);
        charts.privacy.data.datasets[0].data = Object.values(stats.privacy);
        charts.privacy.update('none');
    }
}

// 更新网络统计
function updateNetwork(url) {
    stats.total.network++;
    const el = document.getElementById('count-network');
    if(el) el.innerText = stats.total.network;

    let domain = 'Unknown';
    try {
        const urlObj = new URL(url);
        domain = urlObj.hostname;
    } catch (e) {}

    // 如果解析失败(Unknown)，直接丢弃，不计入域名统计
    if (domain === 'Unknown') {
        return;
    }

    stats.domains[domain] = (stats.domains[domain] || 0) + 1;

    if (charts.network) {
        const sortedDomains = Object.entries(stats.domains)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);
        
        charts.network.data.labels = sortedDomains.map(([k]) => k);
        charts.network.data.datasets[0].data = sortedDomains.map(([,v]) => v);
        charts.network.update('none');
    }
}

// 更新文件统计
function updateFile() {
    stats.total.file++;
    const el = document.getElementById('count-file');
    if(el) el.innerText = stats.total.file;
}

function updateWebView(data) {
    const list = document.getElementById('webviewUrlList');
    const count = document.getElementById('webview-count');
    if (!list) return;

    const entry = {
        timestamp: data.timestamp || new Date().toLocaleTimeString('en-GB', { hour12: false }),
        source: data.source || 'WebView navigation',
        url: data.url || ''
    };
    stats.webview.unshift(entry);
    stats.webview = stats.webview.slice(0, 20);

    const item = document.createElement('li');
    item.className = 'list-group-item py-2';
    const meta = document.createElement('div');
    meta.className = 'd-flex justify-content-between align-items-center gap-2 mb-1';
    const source = document.createElement('span');
    source.className = 'badge bg-info text-dark text-truncate';
    source.textContent = entry.source;
    source.title = entry.source;
    const timestamp = document.createElement('span');
    timestamp.className = 'small text-muted font-monospace text-nowrap';
    timestamp.textContent = entry.timestamp;
    const url = document.createElement('div');
    url.className = 'font-monospace small text-break';
    url.textContent = entry.url;
    url.title = entry.url;
    meta.append(source, timestamp);
    item.append(meta, url);

    if (list.children.length === 1 && list.firstElementChild.classList.contains('text-center')) {
        list.innerHTML = '';
    }
    list.prepend(item);
    while (list.children.length > 20) list.lastElementChild.remove();
    if (count) count.innerText = `${stats.webview.length} captured`;
}

// 清空统计
function clear() {
    stats.privacy = {};
    stats.domains = {};
    stats.webview = [];
    stats.total = { privacy: 0, network: 0, file: 0 };
    
    ['count-privacy', 'count-network', 'count-file'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.innerText = '0';
    });

    if(charts.privacy) {
        charts.privacy.data.labels = [];
        charts.privacy.data.datasets[0].data = [];
        charts.privacy.update();
    }
    if(charts.network) {
        charts.network.data.labels = [];
        charts.network.data.datasets[0].data = [];
        charts.network.update();
    }
    renderEmptyWebViewState();
}

export const Dashboard = {
    init,
    updatePrivacy,
    updateNetwork,
    updateFile,
    updateWebView,
    clear
};
