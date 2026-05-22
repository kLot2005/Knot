import { Worker } from 'bullmq';
import { prisma } from './db';
import { redis } from './redis';

async function getEmbedding(text: string): Promise<number[] | null> {
    try {
        const response = await fetch('http://localhost:11434/api/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'bge-m3',
                prompt: text,
            }),
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.embedding;
    } catch (e) {
        console.error('Failed to fetch embedding from Ollama:', e);
        throw e; // Triggers retry in BullMQ
    }
}

export const embeddingWorker = new Worker('news_embedding_queue', async (job) => {
    const { id } = job.data;

    // Find item
    const newsItem = await prisma.newsItem.findUnique({
        where: { id },
    });

    if (!newsItem) {
        throw new Error(`NewsItem ${id} not found`);
    }

    if (!newsItem.normalized_text) {
        return; // nothing to embed
    }

    console.log(`[Worker] Generating embedding for item ${id}...`);

    const embedding = await getEmbedding(newsItem.normalized_text);

    if (embedding) {
        // Create an explicit string representation of the array e.g. "[0.1, 0.2, ...]" for pgvector
        const embeddingStr = JSON.stringify(embedding);
        await prisma.$executeRawUnsafe('UPDATE news_items SET embedding = $1::vector WHERE id = $2', embeddingStr, id);
        console.log(`[Worker] Saved 1024-d embedding for item ${id}`);
    }

}, {
    connection: redis
});

// Configure default retry behavior
embeddingWorker.on('failed', (job, err) => {
    if (job) {
        console.log(`[Worker] Job ${job.id} failed with error ${err.message}. Retrying...`);
    }
});

import { clusterize } from './clusterizer';
export const clusterWorker = new Worker('cluster_queue', async (job) => {
    if (job.name === 'cluster_task') {
        await clusterize();
    }
}, { connection: redis });
