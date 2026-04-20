/* ─────────────────────────────────────────────────────────────────
   cc-guard dashboard — client-side orchestration.

   Zero-dep vanilla JS. Responsibilities:
   - Tab switching (4 sections, client-side only)
   - Fetch REST endpoints on tab activation (lazy)
   - SSE connection: stream live alerts + events, flash new rows
   - Slide-over event detail panel
   - Filter chips for alerts (by severity) + events (by source)
   - Search across alerts + events (⌘F)

   All rendering is string-based innerHTML with explicit escape() to
   keep surface small. Replace with DOM-builder helpers if mutation
   surface grows.
   ───────────────────────────────────────────────────────────────── */

/** @typedef {'info'|'low'|'medium'|'high'} Severity */

const state = {
    overview: null,
    alerts: [],
    events: [],
    config: null,
    currentTab: 'overview',
    alertsFilter: 'all',
    eventsSourceFilter: 'all',
    search: '',
    sse: null,
    sseRetries: 0,
};

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3 };

// ─── init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    wireTabs();
    wireSearch();
    wireAlertsFilter();
    wireSlideOver();

    loadOverview();
    connectSse();
});

// ─── tab switching ─────────────────────────────────────────────

function wireTabs() {
    document.querySelectorAll('.side-item[data-tab]').forEach(el => {
        const activate = () => switchTab(el.dataset.tab);
        el.addEventListener('click', activate);
        el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
    });
}

function switchTab(name) {
    if (state.currentTab === name) return;
    state.currentTab = name;

    document.querySelectorAll('.side-item[data-tab]').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === name);
    });
    document.querySelectorAll('.tab').forEach(el => {
        el.classList.toggle('active', el.id === `tab-${name}`);
    });

    // Lazy-load per tab on first visit
    if (name === 'alerts' && state.alerts.length === 0) loadAlerts();
    if (name === 'events' && state.events.length === 0) loadEvents();
    if (name === 'settings' && !state.config) loadConfig();
}

// ─── search ────────────────────────────────────────────────────

function wireSearch() {
    const input = document.getElementById('search-input');
    input.addEventListener('input', e => {
        state.search = e.target.value.trim().toLowerCase();
        if (state.currentTab === 'alerts') renderAlerts();
        else if (state.currentTab === 'events') renderEvents();
    });

    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            input.focus();
            input.select();
        }
    });
}

// ─── alerts filter ─────────────────────────────────────────────

function wireAlertsFilter() {
    document.querySelectorAll('#tab-alerts .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#tab-alerts .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.alertsFilter = chip.dataset.filter;
            renderAlerts();
        });
    });
}

// ─── slide-over ────────────────────────────────────────────────

function wireSlideOver() {
    const close = () => {
        document.getElementById('slide-over').classList.remove('active');
        document.getElementById('slide-over-scrim').classList.remove('active');
    };
    document.getElementById('slide-over-close').addEventListener('click', close);
    document.getElementById('slide-over-scrim').addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function showEventDetail(event) {
    document.getElementById('slide-over-title').textContent = `${event.source} · ${event.type}`;
    document.getElementById('so-time').textContent = event.ts;
    document.getElementById('so-source').textContent = event.source;
    document.getElementById('so-type').textContent = event.type;
    document.getElementById('so-json').textContent = JSON.stringify(event.raw ?? {}, null, 2);
    document.getElementById('slide-over').classList.add('active');
    document.getElementById('slide-over-scrim').classList.add('active');
}

// ─── API calls ─────────────────────────────────────────────────

async function apiGet(path) {
    const r = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
}

async function loadOverview() {
    try {
        state.overview = await apiGet('/api/overview');
        renderOverview();
        document.getElementById('alerts-count').textContent = String(state.overview.activeAlerts);
    } catch (err) { console.warn('overview load failed', err); }
}

async function loadAlerts() {
    try {
        const data = await apiGet('/api/alerts?limit=100');
        state.alerts = data.alerts;
        renderAlerts();
    } catch (err) { console.warn('alerts load failed', err); }
}

async function loadEvents() {
    try {
        const data = await apiGet('/api/events?limit=200');
        state.events = data.events;
        renderEventSources();
        renderEvents();
    } catch (err) { console.warn('events load failed', err); }
}

async function loadConfig() {
    try {
        state.config = await apiGet('/api/config');
        renderSettings();
    } catch (err) { console.warn('config load failed', err); }
}

// ─── SSE ───────────────────────────────────────────────────────

function connectSse() {
    if (state.sse) return;

    const es = new EventSource('/api/stream');
    state.sse = es;

    es.addEventListener('open', () => {
        document.querySelector('.window').dataset.connected = 'true';
        document.querySelector('.live-text').textContent = 'live';
        state.sseRetries = 0;
    });

    es.addEventListener('overview', e => {
        const data = JSON.parse(e.data);
        state.overview = data;
        renderOverview();
        document.getElementById('alerts-count').textContent = String(data.activeAlerts);
    });

    es.addEventListener('alert', e => {
        const alert = JSON.parse(e.data);
        state.alerts.unshift(alert);
        if (state.alerts.length > 100) state.alerts.pop();
        if (state.currentTab === 'alerts') renderAlerts({ flashId: alert.id });
        // Update sidebar badge even if Overview tab has stale alert count
        if (state.overview) {
            state.overview.activeAlerts = (state.overview.activeAlerts ?? 0) + 1;
            document.getElementById('alerts-count').textContent = String(state.overview.activeAlerts);
        }
    });

    es.addEventListener('event', e => {
        const ev = JSON.parse(e.data);
        state.events.unshift(ev);
        if (state.events.length > 200) state.events.pop();
        if (state.currentTab === 'events') renderEvents({ flashId: ev.id });
    });

    es.addEventListener('error', () => {
        document.querySelector('.window').dataset.connected = 'false';
        document.querySelector('.live-text').textContent = 'reconnecting…';
        // EventSource auto-reconnects with its own exponential backoff.
        // Bump a counter so we could show staleness after N failures.
        state.sseRetries += 1;
    });
}

// ─── render: overview ──────────────────────────────────────────

function renderOverview() {
    const o = state.overview;
    if (!o) return;

    const overallStatus = worstOf(o.signals?.map(s => s.status) ?? []);
    const count = o.activeAlerts ?? 0;

    const numEl = document.getElementById('hero-num');
    numEl.textContent = String(count);
    numEl.className = 'big-num ' + (count === 0 ? 'ok' : overallStatus === 'crit' ? 'crit' : 'warn');

    document.getElementById('hero-title').textContent =
        count === 0 ? 'No open alerts' :
        count === 1 ? 'Open alert' : 'Open alerts';
    document.getElementById('hero-sub').textContent = o.statusDetail ?? 'All signals within thresholds';

    document.getElementById('hero-status').textContent =
        overallStatus === 'ok' ? 'Nominal' : overallStatus === 'warn' ? 'Degraded' : 'Alert';
    document.getElementById('hero-uptime').textContent = o.uptime ?? '—';
    document.getElementById('hero-version').textContent = 'v' + (o.version ?? '?');

    // Signals
    const sig = document.getElementById('signals-group');
    if (!o.signals?.length) {
        sig.innerHTML = `<div class="row row-empty">No signals active.</div>`;
    } else {
        sig.innerHTML = o.signals.map(renderSignalRow).join('');
    }

    // Recent alerts (top 3)
    const recent = (o.recentAlerts ?? []).slice(0, 3);
    const ra = document.getElementById('overview-alerts');
    if (!recent.length) {
        ra.innerHTML = `<div class="alert-row row-empty">No alerts in the last 24h.</div>`;
    } else {
        ra.innerHTML = recent.map(renderAlertRow).join('');
    }
}

function renderSignalRow(sig) {
    return `<div class="row">
        <span class="status-dot ${escape(sig.status)}"></span>
        <span class="name">${escape(sig.name)}
            ${sig.since ? `<span class="sub">first observed ${escape(sig.since)}</span>` : ''}
        </span>
        <span class="val">${escape(sig.value)}${sig.subValue ? ` <span style="color:var(--fg-tertiary)">· ${escape(sig.subValue)}</span>` : ''}</span>
        <span class="status ${escape(sig.status)}">${statusLabel(sig.status)}</span>
    </div>`;
}

function statusLabel(s) {
    return ({ ok: 'Nominal', warn: 'Degraded', crit: 'Alert', info: 'Info' })[s] ?? s;
}

function renderAlertRow(alert) {
    return `<div class="alert-row" data-id="${escape(alert.id)}">
        <span class="time">${escape(formatTime(alert.ts))}</span>
        <div>
            <div class="title">${escape(alert.title)}</div>
            <div class="advice">${escape(alert.advice)}</div>
        </div>
        <span class="sev ${escape(alert.level)}">${escape(alert.level)}</span>
    </div>`;
}

// ─── render: alerts ────────────────────────────────────────────

function renderAlerts(opts = {}) {
    const container = document.getElementById('alerts-group');
    const filter = state.alertsFilter;
    const q = state.search;

    const filtered = state.alerts.filter(a => {
        if (filter !== 'all' && a.level !== filter) return false;
        if (q && !matchesSearch(a, q)) return false;
        return true;
    });

    document.getElementById('alerts-filter-count').textContent =
        `${filtered.length} / ${state.alerts.length}`;

    if (!filtered.length) {
        container.innerHTML = `<div class="alert-row row-empty">No matching alerts.</div>`;
        return;
    }
    container.innerHTML = filtered.map(renderAlertRow).join('');

    if (opts.flashId) {
        const el = container.querySelector(`[data-id="${CSS.escape(opts.flashId)}"]`);
        if (el) el.classList.add('new');
    }
}

function matchesSearch(a, q) {
    return (a.title?.toLowerCase().includes(q)
        || a.advice?.toLowerCase().includes(q)
        || a.signal?.toLowerCase().includes(q));
}

// ─── render: events ────────────────────────────────────────────

function renderEventSources() {
    const sources = [...new Set(state.events.map(e => e.source))].sort();
    const bar = document.getElementById('events-source-filter');
    const existing = bar.querySelectorAll('.chip[data-source]:not([data-source="all"])');
    existing.forEach(c => c.remove());

    sources.forEach(src => {
        const b = document.createElement('button');
        b.className = 'chip';
        b.dataset.source = src;
        b.textContent = src;
        b.addEventListener('click', () => {
            document.querySelectorAll('#events-source-filter .chip').forEach(c => c.classList.remove('active'));
            b.classList.add('active');
            state.eventsSourceFilter = src;
            renderEvents();
        });
        bar.appendChild(b);
    });

    bar.querySelector('[data-source="all"]').addEventListener('click', () => {
        document.querySelectorAll('#events-source-filter .chip').forEach(c => c.classList.remove('active'));
        bar.querySelector('[data-source="all"]').classList.add('active');
        state.eventsSourceFilter = 'all';
        renderEvents();
    }, { once: true });
}

function renderEvents(opts = {}) {
    const rows = document.getElementById('events-rows');
    const src = state.eventsSourceFilter;
    const q = state.search;

    const filtered = state.events.filter(e => {
        if (src !== 'all' && e.source !== src) return false;
        if (q) {
            const hay = `${e.source} ${e.type} ${e.summary}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    document.getElementById('events-filter-count').textContent =
        `${filtered.length} / ${state.events.length}`;

    if (!filtered.length) {
        rows.innerHTML = `<div class="event-row row-empty">No matching events.</div>`;
        return;
    }

    rows.innerHTML = filtered.map(e => `
        <div class="event-row" data-id="${escape(e.id)}">
            <span class="time">${escape(formatTime(e.ts))}</span>
            <span class="source">${escape(e.source)}</span>
            <span class="type">${escape(e.type)}</span>
            <span class="summary">${escape(e.summary ?? '')}</span>
        </div>`).join('');

    // Wire click → slide-over
    rows.querySelectorAll('.event-row[data-id]').forEach(row => {
        row.addEventListener('click', () => {
            const ev = state.events.find(x => x.id === row.dataset.id);
            if (ev) showEventDetail(ev);
        });
    });

    if (opts.flashId) {
        const el = rows.querySelector(`[data-id="${CSS.escape(opts.flashId)}"]`);
        if (el) el.classList.add('new');
    }
}

// ─── render: settings ──────────────────────────────────────────

function renderSettings() {
    const c = state.config;
    if (!c) return;

    // Backends
    const bg = document.getElementById('backends-group');
    const backends = c.backends ?? {};
    bg.innerHTML = Object.entries(backends).map(([name, cfg]) => `
        <div class="row">
            <span class="status-dot ${cfg.enabled ? 'ok' : 'info'}"></span>
            <span class="name">${escape(prettyBackendName(name))}
                ${cfg.enabled ? `<span class="sub">min_level: ${escape(cfg.min_level ?? 'info')}</span>` : '<span class="sub">disabled</span>'}
            </span>
            <span class="val">${cfg.extra ? escape(cfg.extra) : ''}</span>
            <span class="status ${cfg.enabled ? 'ok' : 'info'}">${cfg.enabled ? 'Active' : 'Off'}</span>
        </div>`).join('');

    // Config dump
    document.getElementById('config-dump').textContent = JSON.stringify(c.config, null, 2);

    // About
    document.getElementById('about-version').textContent = 'v' + (c.meta?.version ?? '?');
    document.getElementById('about-port').textContent = String(c.meta?.port ?? '?');
    document.getElementById('about-pid').textContent = String(c.meta?.pid ?? '?');
}

function prettyBackendName(key) {
    return { stderr: 'stderr', os_notify: 'OS notification', json_log: 'JSON log', webhook: 'Webhook', wechat_cc: 'wechat-cc bridge' }[key] ?? key;
}

// ─── utils ─────────────────────────────────────────────────────

function escape(s) {
    if (s == null) return '';
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatTime(isoOrEpoch) {
    if (!isoOrEpoch) return '—';
    const d = typeof isoOrEpoch === 'number' ? new Date(isoOrEpoch) : new Date(isoOrEpoch);
    if (isNaN(d.getTime())) return String(isoOrEpoch);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function worstOf(statuses) {
    if (statuses.includes('crit')) return 'crit';
    if (statuses.includes('warn')) return 'warn';
    return 'ok';
}
