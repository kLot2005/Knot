import { prisma } from './db';

const COSINE_THRESHOLD = 0.35; // Увеличен порог с 0.2 до 0.35 для более мягкого объединения перефразирований

export async function clusterize() {
    console.log('[Clusterizer] Starting clustering process...');

    try {
        const unclustered: any[] = await prisma.$queryRaw`
            SELECT id 
            FROM news_items 
            WHERE cluster_id IS NULL AND embedding IS NOT NULL
            ORDER BY created_at ASC
        `;

        let processedIds = new Set<number>();
        let clustersCreated = 0;

        for (const item of unclustered) {
            if (processedIds.has(item.id)) continue;

            const clusterNodes = new Set<number>([item.id]);
            const queue = [item.id];

            // Настоящий алгоритм "Снежного кома" (DBSCAN-like)
            while (queue.length > 0) {
                const currentId = queue.pop()!;

                const neighbors: any[] = await prisma.$queryRaw`
                    SELECT id, (embedding <=> (SELECT embedding FROM news_items WHERE id = ${currentId})) as distance
                    FROM news_items
                    WHERE cluster_id IS NULL AND embedding IS NOT NULL
                    AND id != ${currentId}
                `;

                const closeNeighbors = neighbors.filter(n => n.distance < COSINE_THRESHOLD);

                for (const n of closeNeighbors) {
                    if (!clusterNodes.has(n.id) && !processedIds.has(n.id)) {
                        clusterNodes.add(n.id);
                        queue.push(n.id); // Закидываем в очередь на поиск соседей этого соседа
                    }
                }
            }

            if (clusterNodes.size >= 2) {
                const clusterArr = Array.from(clusterNodes);

                const cluster = await prisma.newsCluster.create({
                    data: {
                        news_count: clusterArr.length,
                    }
                });

                await prisma.newsItem.updateMany({
                    where: { id: { in: clusterArr } },
                    data: { cluster_id: cluster.id }
                });

                clusterArr.forEach(id => processedIds.add(id));
                clustersCreated++;
                console.log(`[Clusterizer] Created cluster #${cluster.id} grouping ${clusterArr.length} items`);
            } else {
                processedIds.add(item.id);
            }
        }

        console.log(`[Clusterizer] Finished. Created ${clustersCreated} new clusters.`);
    } catch (e) {
        console.error('[Clusterizer] Error:', e);
    }
}
