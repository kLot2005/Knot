import { prisma } from './db';
import { synthesisQueue } from './queue';

const COSINE_THRESHOLD = 0.38;

/**
 * Косинусное сходство между двумя векторами
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    // Превращаем сходство (0..1) в расстояние (0..1) для совместимости с логикой DBSCAN
    return 1 - similarity;
}

export async function clusterize() {
    console.log('[Clusterizer] Starting optimized in-memory clustering...');

    try {
        const dateLimit = new Date();
        dateLimit.setHours(dateLimit.getHours() - 36); // Захватываем чуть больше времени

        // 1. Выгружаем ВСЕ неразобранные новости ОДНИМ запросом
        const candidates: any[] = await prisma.$queryRaw`
            SELECT id, embedding::text as embedding_str
            FROM news_items 
            WHERE cluster_id IS NULL AND embedding IS NOT NULL
            AND created_at > ${dateLimit}
            ORDER BY created_at ASC
        `;

        if (candidates.length === 0) {
            console.log('[Clusterizer] No new candidates for clustering.');
            return;
        }

        // Парсим векторы из строк
        const items = candidates.map(c => ({
            id: c.id,
            vector: JSON.parse(c.embedding_str) as number[]
        }));

        const processedIds = new Set<number>();
        let clustersCreated = 0;

        // 2. Кластеризация в памяти (быстрая)
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (processedIds.has(item.id)) continue;

            const clusterNodes = new Set<number>([item.id]);
            const queue = [item];
            const anchor = item;

            while (queue.length > 0) {
                const current = queue.pop()!;

                for (let j = 0; j < items.length; j++) {
                    const neighbor = items[j];
                    if (processedIds.has(neighbor.id) || clusterNodes.has(neighbor.id)) continue;

                    const distToCurrent = cosineSimilarity(current.vector, neighbor.vector);
                    const distToAnchor = cosineSimilarity(anchor.vector, neighbor.vector);

                    // Условия жесткой склейки
                    if (distToCurrent < COSINE_THRESHOLD && distToAnchor < 0.5) {
                        clusterNodes.add(neighbor.id);
                        queue.push(neighbor);
                    }
                }
            }

            if (clusterNodes.size >= 3) {
                const clusterArr = Array.from(clusterNodes);

                // 3. Сохраняем результат в БД
                const cluster = await prisma.newsCluster.create({ data: {} });
                await prisma.newsItem.updateMany({
                    where: { id: { in: clusterArr } },
                    data: { cluster_id: cluster.id }
                });

                clusterArr.forEach(id => processedIds.add(id));
                clustersCreated++;

                await synthesisQueue.add('synthesis_task', { clusterId: cluster.id }, {
                    attempts: 2,
                    backoff: { type: 'exponential', delay: 2000 }
                });

                console.log(`[Clusterizer] Created cluster #${cluster.id} with ${clusterArr.length} items`);
            } else {
                processedIds.add(item.id);
            }
        }

        console.log(`[Clusterizer] Finished. Total new clusters: ${clustersCreated}`);
    } catch (e) {
        console.error('[Clusterizer] Critical Error:', e);
    }
}
