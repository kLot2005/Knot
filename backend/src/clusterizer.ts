import { prisma } from './db';
import { synthesisQueue } from './queue';

const COSINE_THRESHOLD = 0.38; // 0.38 - оптимальный баланс между точностью и полнотой для bge-m3

export async function clusterize() {
    console.log('[Clusterizer] Starting clustering process...');

    try {
        // Ограничиваем область поиска: берем только те новости, которые не старше 2 суток.
        // Это повышает производительность и защищает от склеивания старой "архивной" новости с новой.
        const dateLimit = new Date();
        dateLimit.setHours(dateLimit.getHours() - 48);

        const unclustered: any[] = await prisma.$queryRaw`
            SELECT id, created_at, embedding 
            FROM news_items 
            WHERE cluster_id IS NULL AND embedding IS NOT NULL
            AND created_at > ${dateLimit}
            ORDER BY created_at ASC
        `;

        let processedIds = new Set<number>();
        let clustersCreated = 0;

        for (const item of unclustered) {
            if (processedIds.has(item.id)) continue;

            const clusterNodes = new Set<number>([item.id]);
            const queue = [item.id];
            const anchorEmbedding = item.embedding; // Первый элемент становится "якорем" темы

            // Рекурсивный поиск соседей (DBSCAN-like)
            while (queue.length > 0) {
                const currentId = queue.pop()!;

                // Ищем соседей только среди неразобранного и не слишком старого
                const neighbors: any[] = await prisma.$queryRaw`
                    SELECT id, created_at, 
                        (embedding <=> (SELECT embedding FROM news_items WHERE id = ${currentId})) as distance_to_neighbor,
                        (embedding <=> ${anchorEmbedding}::vector) as distance_to_anchor
                    FROM news_items
                    WHERE cluster_id IS NULL AND embedding IS NOT NULL
                    AND id != ${currentId}
                    AND created_at > ${dateLimit}
                `;

                // Условия включения в кластер:
                // 1. Порог близости к текущему соседу (0.38)
                // 2. ЗАЩИТА ОТ ДРЕЙФА: Порог близости к изначальному "якорю" кластера (0.5).
                // Это не дает кластеру плавно "уплыть" от темы "ДТП" к теме "Ремонт дорог".
                const closeNeighbors = neighbors.filter(n =>
                    n.distance_to_neighbor < COSINE_THRESHOLD &&
                    n.distance_to_anchor < 0.5
                );

                for (const n of closeNeighbors) {
                    if (!clusterNodes.has(n.id) && !processedIds.has(n.id)) {
                        clusterNodes.add(n.id);
                        queue.push(n.id);
                    }
                }
            }

            if (clusterNodes.size >= 2) {
                const clusterArr = Array.from(clusterNodes);

                const cluster = await prisma.newsCluster.create({ data: {} });

                await prisma.newsItem.updateMany({
                    where: { id: { in: clusterArr } },
                    data: { cluster_id: cluster.id }
                });

                clusterArr.forEach(id => processedIds.add(id));
                clustersCreated++;
                console.log(`[Clusterizer] Created cluster #${cluster.id} grouping ${clusterArr.length} items`);

                // Queue for synthesis
                await synthesisQueue.add('synthesis_task', { clusterId: cluster.id }, {
                    attempts: 2,
                    backoff: { type: 'exponential', delay: 1000 }
                });
            } else {
                processedIds.add(item.id);
            }
        }

        console.log(`[Clusterizer] Finished. Created ${clustersCreated} new clusters.`);
    } catch (e) {
        console.error('[Clusterizer] Error:', e);
    }
}
