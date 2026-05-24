import { Worker, Job } from 'bullmq';
import { redis } from './redis';
import { prisma } from './db';
import { clusterize } from './clusterizer';
import { synthesizeCluster } from './generator';

// Ollama API configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api';

// --- EMBEDDING WORKER ---
export const embeddingWorker = new Worker('embedding_queue', async (job: Job) => {
    const { id } = job.data;
    const item = await prisma.newsItem.findUnique({ where: { id } });

    if (!item || item.normalized_text.length < 25) return;

    const cleanTextForModel = item.normalized_text.slice(0, 5000);

    try {
        console.log(`[Worker] Generating embedding for item ${id} via Ollama...`);

        const response = await fetch(`${OLLAMA_URL}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'bge-m3',
                prompt: cleanTextForModel
            })
        });

        if (!response.ok) throw new Error(`Ollama error: ${response.statusText}`);

        const data: any = await response.json();
        if (data.embedding) {
            // Для PostgreSQL pgvector формат: [1, 2, 3]
            const vectorStr = `[${data.embedding.join(',')}]`;

            await prisma.$executeRawUnsafe(
                `UPDATE "news_items" SET embedding = $1::vector WHERE id = $2`,
                vectorStr,
                id
            );
            console.log(`[Worker] Saved embedding for item ${id}`);
        }
    } catch (e: any) {
        console.error(`[Worker] Embedding failed for ${id}:`, e.message);
        throw e;
    }
}, {
    connection: redis,
    concurrency: 1 // Снижаем нагрузку на Ollama до 1 задачи за раз
});

// --- CLUSTER WORKER ---
export const clusterWorker = new Worker('cluster_queue', async (job: Job) => {
    console.log('[Worker] Starting periodic clustering...');
    await clusterize();
    console.log('[Worker] Clustering completed.');
}, { connection: redis });

// --- SYNTHESIS WORKER (AI Generation) ---
export const synthesisWorker = new Worker('synthesis_queue', async (job: Job) => {
    const { clusterId } = job.data;
    console.log(`[Worker] Processing synthesis for cluster ${clusterId}...`);
    await synthesizeCluster(clusterId);
}, {
    connection: redis,
    concurrency: 1 // LLM обычно кушает много GPU, лучше по одной задаче за раз
});
