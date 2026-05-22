import { Worker, Job } from 'bullmq';
import { redis } from './redis';
import { prisma } from './db';
import { clusterize } from './clusterizer';
import { synthesizeCluster } from './generator';

// Ollama API configuration
const OLLAMA_URL = 'http://localhost:11434/api';

// --- EMBEDDING WORKER ---
// Повышаем производительность: обрабатываем до 3 сообщений параллельно (concurrency: 3)
export const embeddingWorker = new Worker('embedding_queue', async (job: Job) => {
    const { id } = job.data;
    const item = await prisma.newsItem.findUnique({ where: { id } });

    // Если новости нет или она слишком короткая (мусор), пропускаем
    if (!item) return;
    if (item.normalized_text.length < 40) {
        console.log(`[Worker] Skipping too short text for item ${id}`);
        return;
    }

    // Модель bge-m3 имеет свой лимит контекста. 
    // На всякий случай обрезаем сверхдлинные тексты (> 5000 символов), чтобы Ollama не упала.
    const cleanTextForModel = item.normalized_text.slice(0, 5000);

    try {
        console.log(`[Worker] Generating embedding for item ${id}...`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // Таймаут 30 сек

        const response = await fetch(`${OLLAMA_URL}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'bge-m3',
                prompt: cleanTextForModel
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);

        const data: any = await response.json();
        if (data.embedding) {
            await prisma.$executeRawUnsafe(`
                UPDATE "news_items"
                SET embedding = '[${data.embedding.join(',')}]'
                WHERE id = ${id}
            `);
            console.log(`[Worker] Saved embedding for item ${id}`);
        } else {
            throw new Error('No embedding array returned from Ollama');
        }
    } catch (e: any) {
        const errorMsg = e.name === 'AbortError' ? 'Timeout' : e.message;
        console.error(`[Worker] Failed generating embedding for ${id}:`, errorMsg);
        throw e; // Повтор через BullMQ
    }
}, {
    connection: redis,
    concurrency: 3 // Разрешаем обрабатывать 3 задачи одновременно (если GPU потянет)
});

// --- CLUSTER WORKER ---
export const clusterWorker = new Worker('cluster_queue', async (job: Job) => {
    console.log('[Worker] Starting periodic clustering task...');
    await clusterize();
    console.log('[Worker] Clustering task completed.');
}, { connection: redis });

// --- SYNTHESIS WORKER ---
export const synthesisWorker = new Worker('synthesis_queue', async (job: Job) => {
    const { clusterId } = job.data;
    console.log(`[Worker] Starting synthesis for cluster ${clusterId}...`);
    await synthesizeCluster(clusterId);
}, {
    connection: redis,
    concurrency: 1
});


