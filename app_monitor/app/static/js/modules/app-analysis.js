import { API } from './api.js';
import { state } from './state.js';
import { UI } from './ui.js';

let dumpToolAvailable = false;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setButtonLoading(button, loading, label) {
    if (!button) return;
    button.disabled = loading;
    button.innerHTML = loading
        ? '<span class="spinner-border spinner-border-sm me-1"></span>Working...'
        : label;
}

function setDumpToolStatus(status) {
    dumpToolAvailable = Boolean(status?.available);
    const badge = document.getElementById('dumpToolStatus');
    const note = document.getElementById('dumpToolNote');
    const dumpButton = document.getElementById('dumpIpaBtn');

    if (badge) {
        badge.className = `badge ${dumpToolAvailable ? 'bg-success' : 'bg-secondary'}`;
        badge.textContent = dumpToolAvailable ? 'iDump ready' : 'iDump required';
    }
    if (note) note.textContent = status?.message || 'Checking iDump availability...';
    if (dumpButton) dumpButton.disabled = !dumpToolAvailable || !state.selectedAnalysisApp;
}

function renderList(elementId, entries, emptyText) {
    const element = document.getElementById(elementId);
    if (!element) return;

    if (!entries || entries.length === 0) {
        element.innerHTML = `<li class="list-group-item text-muted small">${escapeHtml(emptyText)}</li>`;
        return;
    }

    element.innerHTML = entries.map((entry) => (
        `<li class="list-group-item font-monospace small text-break">${escapeHtml(entry)}</li>`
    )).join('');
}

function renderAnalysis(data) {
    const results = document.getElementById('analysisResults');
    const placeholder = document.getElementById('analysisPlaceholder');
    if (results) results.classList.remove('d-none');
    if (placeholder) placeholder.classList.add('d-none');

    const technologies = data.technologies || [];
    const technologyBody = document.getElementById('technologyBody');
    if (technologyBody) {
        technologyBody.innerHTML = technologies.map((technology) => {
            const confidence = technology.confidence || 'Unknown';
            const badgeClass = confidence === 'High'
                ? 'bg-success'
                : confidence === 'Medium' ? 'bg-warning text-dark' : 'bg-secondary';
            const evidence = (technology.evidence || []).map(escapeHtml).join('<br>');
            return `<tr>
                <td class="fw-bold">${escapeHtml(technology.name)}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(confidence)}</span></td>
                <td class="small font-monospace text-break">${evidence}</td>
            </tr>`;
        }).join('');
    }

    const inspection = data.inspection || {};
    const app = data.app || {};
    const summary = document.getElementById('inspectionSummary');
    if (summary) {
        const fields = [
            ['Name', app.name],
            ['Bundle ID', app.bundle_id],
            ['Version', app.version],
            ['Build', app.build],
            ['Bundle path', inspection.bundle_path],
            ['Executable path', inspection.executable_path]
        ];
        summary.innerHTML = fields.map(([label, value]) => `
            <tr><th class="text-muted fw-normal">${escapeHtml(label)}</th><td class="font-monospace text-break">${escapeHtml(value || '—')}</td></tr>
        `).join('');
    }

    renderList('frameworkList', inspection.embedded_frameworks, 'No embedded frameworks found');
    renderList('extensionList', inspection.app_extensions, 'No app extensions found');

    const moduleBody = document.getElementById('moduleBody');
    if (moduleBody) {
        const modules = inspection.loaded_modules || [];
        moduleBody.innerHTML = modules.length > 0
            ? modules.map((module) => `<tr>
                <td class="font-monospace small">${escapeHtml(module.name)}</td>
                <td class="font-monospace small text-break">${escapeHtml(module.path)}</td>
            </tr>`).join('')
            : '<tr><td colspan="2" class="text-center text-muted py-3">No app-owned modules were loaded</td></tr>';
    }
}

function appendDumpLog(lines) {
    const log = document.getElementById('dumpLog');
    if (!log || !lines?.length) return;
    log.classList.remove('d-none');
    log.textContent = lines.join('\n');
    log.scrollTop = log.scrollHeight;
}

function renderDumpStatus(payload) {
    const status = document.getElementById('dumpStatus');
    const download = document.getElementById('dumpDownload');
    const dumpButton = document.getElementById('dumpIpaBtn');
    if (!status) return;

    const stateName = payload.state || 'unknown';
    const className = stateName === 'completed'
        ? 'text-success'
        : stateName === 'failed' ? 'text-danger' : 'text-primary';
    status.className = `small ${className}`;
    status.textContent = payload.error ? `${payload.message}: ${payload.error}` : payload.message;
    appendDumpLog(payload.logs);

    if (download) {
        if (stateName === 'completed' && payload.output_name) {
            download.href = `/api/artifacts/${encodeURIComponent(payload.output_name)}`;
            download.classList.remove('d-none');
        } else if (stateName !== 'running' && stateName !== 'queued') {
            download.classList.add('d-none');
        }
    }

    if (dumpButton && (stateName === 'completed' || stateName === 'failed')) {
        dumpButton.disabled = !dumpToolAvailable || !state.selectedAnalysisApp;
    }
}

export const AppAnalysis = {
    init: async () => {
        try {
            const response = await API.getDumpToolStatus();
            if (response.status === 'success') setDumpToolStatus(response.data);
        } catch (_) {
            setDumpToolStatus({ available: false, message: 'Could not check iDump availability' });
        }
    },

    selectApp: (name, bundleId, version) => {
        state.selectedAnalysisApp = { name, bundleId, version };
        const selected = document.getElementById('analysisSelectedApp');
        const analyzeButton = document.getElementById('runAnalysisBtn');
        const dumpButton = document.getElementById('dumpIpaBtn');

        if (selected) selected.textContent = `${name} · ${bundleId}`;
        if (analyzeButton) analyzeButton.disabled = false;
        if (dumpButton) dumpButton.disabled = !dumpToolAvailable;
        document.getElementById('analysisResults')?.classList.add('d-none');
        document.getElementById('analysisPlaceholder')?.classList.remove('d-none');
        const dumpStatus = document.getElementById('dumpStatus');
        if (dumpStatus) {
            dumpStatus.className = 'small text-muted mb-2';
            dumpStatus.textContent = 'Ready to export. Monitoring must be stopped first.';
        }
        document.getElementById('dumpDownload')?.classList.add('d-none');
        const dumpLog = document.getElementById('dumpLog');
        if (dumpLog) {
            dumpLog.textContent = '';
            dumpLog.classList.add('d-none');
        }
        UI.activateTab('#app-analysis');
    },

    run: async () => {
        const app = state.selectedAnalysisApp;
        if (!app) {
            UI.alert('Select an app', 'Choose Analyze next to an installed application first.', '🔬', 'primary');
            return;
        }

        const button = document.getElementById('runAnalysisBtn');
        setButtonLoading(button, true, '🔬 Analyze app');
        try {
            const response = await API.analyzeApp(app.bundleId);
            if (response.status !== 'success') throw new Error(response.message);
            renderAnalysis(response.data);
        } catch (error) {
            UI.alert('Analysis failed', error.message, '❌', 'danger');
        } finally {
            setButtonLoading(button, false, '🔬 Analyze app');
        }
    },

    dump: async () => {
        const app = state.selectedAnalysisApp;
        if (!app || !dumpToolAvailable) return;

        const button = document.getElementById('dumpIpaBtn');
        const log = document.getElementById('dumpLog');
        const download = document.getElementById('dumpDownload');
        if (log) log.textContent = '';
        if (download) download.classList.add('d-none');
        setButtonLoading(button, true, '📦 Dump IPA');

        try {
            const response = await API.dumpIPA(app.bundleId, app.name);
            if (response.status !== 'success') throw new Error(response.message);
            renderDumpStatus(response.data);
        } catch (error) {
            renderDumpStatus({ state: 'failed', message: 'IPA dump failed', error: error.message, logs: [] });
        }
    },

    handleDumpStatus: (payload) => {
        if (payload.bundle_id === state.selectedAnalysisApp?.bundleId) renderDumpStatus(payload);
    }
};
