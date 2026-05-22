import express from 'express';
import path from 'path';
import cors from 'cors';
import { prisma } from './db';
import { redis } from './redis';
import { clusterQueue, embeddingQueue, synthesisQueue } from './queue';

export const app = express();
const PORT = process.env.DASHBOARD_PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// BigInt → string so JSON.stringify doesn't choke on Prisma BigInt fields (e.g. external_id)
app.set('json replacer', (_key: string, value: any) =>
    typeof value === 'bigint' ? value.toString() : value
);

// ── API: Stats ─────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    try {
        const [totalNews, totalClusters, unclustered, last24h] = await Promise.all([
            prisma.newsItem.count(),
            prisma.newsCluster.count(),
            prisma.newsItem.count({ where: { cluster_id: null } }),
            prisma.newsItem.count({
                where: { created_at: { gte: new Date(Date.now() - 86400000) } }
            }),
        ]);

        // Per-channel breakdown
        const byChannel = await prisma.newsItem.groupBy({
            by: ['channel_id'],
            _count: { id: true },
            orderBy: { _count: { id: 'desc' } },
            take: 10
        });

        res.json({ totalNews, totalClusters, unclustered, last24h, byChannel });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Clusters ──────────────────────────────────────────────────
app.get('/api/clusters', async (req, res) => {
    try {
        const clusters = await prisma.newsCluster.findMany({
            orderBy: { created_at: 'desc' },
            take: 50,
            select: {
                id: true,
                created_at: true,
                updated_at: true,
                items: {
                    select: { id: true, external_id: true, channel_id: true, normalized_text: true, created_at: true },
                    orderBy: { created_at: 'desc' }
                }
            }
        });
        res.json(clusters);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Unclustered ───────────────────────────────────────────────
app.get('/api/unclustered', async (req, res) => {
    try {
        const items = await prisma.newsItem.findMany({
            where: { cluster_id: null },
            orderBy: { created_at: 'desc' },
            take: 50,
            select: { id: true, channel_id: true, normalized_text: true, created_at: true }
        });
        res.json(items);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Settings GET ──────────────────────────────────────────────
app.get('/api/settings', async (req, res) => {
    const clusterCron = await redis.get('settings:cluster_cron') || '*/5 * * * *';
    const pollInterval = await redis.get('settings:poll_interval') || '30';
    res.json({ clusterCron, pollInterval: parseInt(pollInterval) });
});

// ── API: Settings POST ─────────────────────────────────────────────
app.post('/api/settings', async (req, res) => {
    try {
        const { clusterCron, pollInterval } = req.body;
        if (clusterCron) await redis.set('settings:cluster_cron', clusterCron);
        if (pollInterval) await redis.set('settings:poll_interval', String(pollInterval));
        res.json({ success: true, message: 'Settings saved. Restart the bot to apply.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Trigger cluster now ───────────────────────────────────────
app.post('/api/cluster/run', async (req, res) => {
    try {
        await clusterQueue.add('cluster_task_manual', {});
        res.json({ success: true, message: 'Clustering job triggered.' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/reprocess-clusters', async (req, res) => {
    try {
        const unprocessed = await prisma.newsCluster.findMany({
            where: { is_processed: false },
            include: { _count: { select: { items: true } } }
        });

        const targets = unprocessed.filter(c => c._count.items >= 2);

        for (const c of targets) {
            await synthesisQueue.add('synthesis_task', { clusterId: c.id });
        }

        res.json({ success: true, count: targets.length });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Queue status ──────────────────────────────────────────────
app.get('/api/queue', async (req, res) => {
    try {
        const [embWaiting, embActive, clWaiting, clActive] = await Promise.all([
            embeddingQueue.getWaitingCount(),
            embeddingQueue.getActiveCount(),
            clusterQueue.getWaitingCount(),
            clusterQueue.getActiveCount(),
        ]);
        res.json({
            embedding: { waiting: embWaiting, active: embActive },
            cluster: { waiting: clWaiting, active: clActive }
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Channels Management ─────────────────────────────────────
app.get('/api/channels', async (req, res) => {
    try {
        const channels = await prisma.sourceChannel.findMany({ orderBy: { username: 'asc' } });
        res.json(channels);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/channels', async (req, res) => {
    try {
        const { username } = req.body;
        if (!username) return res.status(400).json({ error: 'Username is required' });

        // Clean username (@kaztag_tg -> kaztag_tg)
        const cleanUsername = username.replace('@', '').trim();

        const channel = await prisma.sourceChannel.upsert({
            where: { username: cleanUsername },
            update: { is_active: true },
            create: { username: cleanUsername, is_active: true }
        });
        res.json(channel);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.patch('/api/channels/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        const channel = await prisma.sourceChannel.update({
            where: { id: parseInt(id) },
            data: { is_active }
        });
        res.json(channel);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/channels/:id', async (req, res) => {
    try {
        await prisma.sourceChannel.delete({ where: { id: parseInt(req.params.id) } });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export function startDashboard() {
    app.listen(PORT, () => {
        console.log(`[Dashboard] Running at http://localhost:${PORT}`);
    });
}
