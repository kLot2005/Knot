import express from 'express';
import path from 'path';
import cors from 'cors';
import { prisma } from './db';

export const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API: Get clusters
app.get('/api/clusters', async (req, res) => {
    try {
        const clusters = await prisma.newsCluster.findMany({
            orderBy: { created_at: 'desc' },
            include: {
                items: {
                    select: { id: true, channel_id: true, normalized_text: true, created_at: true }
                }
            }
        });
        res.json(clusters);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch clusters' });
    }
});

// API: Get unclustered news (noise or fresh)
app.get('/api/unclustered', async (req, res) => {
    try {
        const items = await prisma.newsItem.findMany({
            where: { cluster_id: null },
            orderBy: { created_at: 'desc' },
            take: 50,
            select: { id: true, channel_id: true, normalized_text: true, created_at: true }
        });
        res.json(items);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch unclustered items' });
    }
});

export function startDashboard() {
    app.listen(PORT, () => {
        console.log(`[Dashboard] Analytical interface is running at http://localhost:${PORT}`);
    });
}
