// ── Navigation ────────────────────────────────────────────────────
function showPage(name, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    el.classList.add('active');

    if (name === 'overview') refreshAll();
    if (name === 'clusters') loadClusters();
    if (name === 'feed') loadFeed();
    if (name === 'channels') loadChannels();
    if (name === 'settings') loadSettings();
}

// ── API helpers ───────────────────────────────────────────────────
async function api(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}

async function post(path, body) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return r.json();
}

// ── Status indicator ──────────────────────────────────────────────
async function checkStatus() {
    try {
        await api('/api/stats');
        document.getElementById('statusDot').className = 'status-dot online';
        document.getElementById('statusText').textContent = 'Online';
    } catch {
        document.getElementById('statusDot').className = 'status-dot';
        document.getElementById('statusText').textContent = 'Offline';
    }
}

// ── OVERVIEW ──────────────────────────────────────────────────────
async function refreshAll() {
    await Promise.all([loadStats(), loadQueue()]);
}

async function loadStats() {
    try {
        const d = await api('/api/stats');
        document.getElementById('s-totalNews').textContent = d.totalNews.toLocaleString();
        document.getElementById('s-totalClusters').textContent = d.totalClusters.toLocaleString();
        document.getElementById('s-unclustered').textContent = d.unclustered.toLocaleString();
        document.getElementById('s-last24h').textContent = d.last24h.toLocaleString();
        renderChannelChart(d.byChannel);
    } catch (e) {
        console.error('loadStats', e);
    }
}

function renderChannelChart(channels) {
    const el = document.getElementById('channelChart');
    if (!channels.length) { el.innerHTML = '<div class="loading">Нет данных</div>'; return; }
    const max = channels[0]._count.id;
    el.innerHTML = channels.map(ch => `
        <div class="channel-bar">
            <div class="channel-bar-label">
                <span>@${ch.channel_id}</span>
                <span>${ch._count.id}</span>
            </div>
            <div class="channel-bar-track">
                <div class="channel-bar-fill" style="width:${(ch._count.id / max * 100).toFixed(1)}%"></div>
            </div>
        </div>
    `).join('');
}

async function loadQueue() {
    try {
        const d = await api('/api/queue');
        document.getElementById('q-emb-active').textContent = d.embedding.active;
        document.getElementById('q-emb-wait').textContent = d.embedding.waiting;
        document.getElementById('q-cl-active').textContent = d.cluster.active;
        document.getElementById('q-cl-wait').textContent = d.cluster.waiting;
        document.getElementById('queueRefreshTime').textContent = new Date().toLocaleTimeString();
    } catch (e) {
        console.error('loadQueue', e);
    }
}

async function triggerCluster() {
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = '⏳ Запущено...';
    try {
        await post('/api/cluster/run', {});
        btn.textContent = '✓ Задача добавлена';
        setTimeout(() => { btn.textContent = '▶ Запустить кластеризацию'; btn.disabled = false; }, 3000);
    } catch {
        btn.textContent = '✕ Ошибка';
        btn.disabled = false;
    }
}

// ── CLUSTERS ──────────────────────────────────────────────────────
// Stores full cluster data keyed by cluster id for copy functionality
const _clusterStore = {};

async function loadClusters() {
    const grid = document.getElementById('clusterGrid');
    grid.innerHTML = '<div class="loading">Загрузка кластеров...</div>';
    try {
        const clusters = await api('/api/clusters');
        if (!clusters.length) { grid.innerHTML = '<div class="loading">Кластеров пока нет.</div>'; return; }

        clusters.forEach(cl => { _clusterStore[cl.id] = cl; });

        grid.innerHTML = clusters.map(cl => `
            <div class="cluster-card">
                <div class="cluster-card-header">
                    <span class="cluster-count">${cl.items.length} новостей</span>
                    <span class="cluster-time">${timeAgo(cl.created_at)}</span>
                </div>
                <div class="cluster-items" style="margin-top:10px;">
                    ${cl.items.slice(0, 4).map(item => `
                        <div class="cluster-item" onclick='openModal(${JSON.stringify(item)})'>
                            <div class="ci-text">${esc(item.normalized_text.substring(0, 85))}…</div>
                            <div class="ci-footer">
                                <span class="ci-ch">@${item.channel_id}</span>
                                <a class="ci-link" href="https://t.me/${item.channel_id}/${item.external_id}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Открыть в Telegram">↗ источник</a>
                            </div>
                        </div>
                    `).join('')}
                    ${cl.items.length > 4 ? `<div class="cluster-item" style="color:var(--text-3);cursor:default">+ ещё ${cl.items.length - 4}</div>` : ''}
                </div>
                <button class="copy-btn" data-id="${cl.id}" onclick="copyCluster(this)" title="Скопировать все тексты">
                    📋 Копировать тексты
                </button>
            </div>
        `).join('');
    } catch (e) {
        grid.innerHTML = `<div class="loading">Ошибка: ${e.message}</div>`;
    }
}

function copyCluster(btn) {
    const cl = _clusterStore[btn.dataset.id];
    if (!cl) return;
    const text = cl.items.map((item, i) =>
        `[${i + 1}] @${item.channel_id} — https://t.me/${item.channel_id}/${item.external_id}\n${item.normalized_text}`
    ).join('\n\n---\n\n');
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = '✓ Скопировано!';
        setTimeout(() => { btn.textContent = '📋 Копировать тексты'; }, 2000);
    }).catch(() => {
        btn.textContent = '✕ Ошибка';
        setTimeout(() => { btn.textContent = '📋 Копировать тексты'; }, 2000);
    });
}

// ── FEED ──────────────────────────────────────────────────────────
async function loadFeed() {
    const list = document.getElementById('feedList');
    list.innerHTML = '<div class="loading">Загрузка ленты...</div>';
    try {
        const items = await api('/api/unclustered');
        if (!items.length) { list.innerHTML = '<div class="loading">Лента пуста.</div>'; return; }

        list.innerHTML = items.map(item => `
            <div class="feed-item" onclick='openModal(${JSON.stringify(item)})'>
                <div class="feed-text">${esc(item.normalized_text)}</div>
                <div class="feed-meta">
                    <span class="feed-channel">@${item.channel_id}</span>
                    <span class="feed-time">${timeAgo(item.created_at)}</span>
                </div>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<div class="loading">Ошибка: ${e.message}</div>`;
    }
}

// ── SETTINGS ──────────────────────────────────────────────────────
async function loadSettings() {
    try {
        const d = await api('/api/settings');
        document.getElementById('set-clusterCron').value = d.clusterCron;
        document.getElementById('set-pollInterval').value = d.pollInterval;
    } catch { }
}

function setCron(val) {
    document.getElementById('set-clusterCron').value = val;
}

function setPoll(val) {
    document.getElementById('set-pollInterval').value = val;
}

async function saveSettings() {
    const msg = document.getElementById('settingsMsg');
    const clusterCron = document.getElementById('set-clusterCron').value.trim();
    const pollInterval = parseInt(document.getElementById('set-pollInterval').value);

    if (!clusterCron) { showMsg('Введите cron-паттерн', true); return; }
    if (isNaN(pollInterval) || pollInterval < 10) { showMsg('Интервал >= 10 секунд', true); return; }

    try {
        const d = await post('/api/settings', { clusterCron, pollInterval });
        showMsg(d.message, false);
    } catch (e) {
        showMsg('Ошибка сохранения', true);
    }
}

function showMsg(text, isErr) {
    const el = document.getElementById('settingsMsg');
    if (el) {
        el.textContent = text;
        el.className = 'settings-msg' + (isErr ? ' err' : '');
        setTimeout(() => { el.textContent = ''; el.className = 'settings-msg'; }, 4000);
    }
}

// ── CHANNELS ──────────────────────────────────────────────────────
async function loadChannels() {
    const table = document.getElementById('channelListTable');
    table.innerHTML = '<div class="loading">Загрузка каналов...</div>';
    try {
        const channels = await api('/api/channels');
        if (!channels.length) {
            table.innerHTML = '<div class="loading">Список пуст. Добавьте первый канал выше.</div>';
            return;
        }

        table.innerHTML = `
            <div class="card-table">
                ${channels.map(ch => `
                    <div class="table-row">
                        <div class="ch-info">
                            <span class="ch-username">@${ch.username}</span>
                            <span class="ch-active-tag ${ch.is_active ? 'active' : ''}">
                                ${ch.is_active ? 'активен' : 'пауза'}
                            </span>
                        </div>
                        <div class="ch-actions">
                            <button class="btn-icon" onclick="toggleChannel(${ch.id}, ${!ch.is_active})" title="${ch.is_active ? 'Выключить' : 'Включить'}">
                                ${ch.is_active ? '⏸' : '▶'}
                            </button>
                            <button class="btn-icon delete" onclick="deleteChannel(${ch.id})" title="Удалить">🗑</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } catch (e) {
        table.innerHTML = `<div class="loading err">Ошибка: ${e.message}</div>`;
    }
}

async function addChannel() {
    const input = document.getElementById('newChannelInput');
    const username = input.value.trim();
    if (!username) return;

    try {
        await post('/api/channels', { username });
        input.value = '';
        loadChannels();
    } catch (e) {
        alert('Ошибка при добавлении: ' + e.message);
    }
}

async function toggleChannel(id, is_active) {
    try {
        await fetch(`/api/channels/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active })
        });
        loadChannels();
    } catch (e) {
        console.error(e);
    }
}

async function deleteChannel(id) {
    if (!confirm('Удалить канал из списка отслеживания?')) return;
    try {
        await fetch(`/api/channels/${id}`, { method: 'DELETE' });
        loadChannels();
    } catch (e) {
        console.error(e);
    }
}

// ── MODAL ──────────────────────────────────────────────────────────
function openModal(item) {
    document.getElementById('modalChannel').textContent = '@' + item.channel_id;
    document.getElementById('modalText').textContent = item.normalized_text;
    document.getElementById('modalDate').textContent = new Date(item.created_at).toLocaleString('ru');
    document.getElementById('textModal').classList.add('open');
}

function closeModal() {
    document.getElementById('textModal').classList.remove('open');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── UTILS ─────────────────────────────────────────────────────────
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'только что';
    if (m < 60) return m + ' мин назад';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ч назад';
    return Math.floor(h / 24) + ' дн назад';
}

// ── INIT ──────────────────────────────────────────────────────────
refreshAll();
checkStatus();
setInterval(loadQueue, 10000);
setInterval(checkStatus, 15000);
