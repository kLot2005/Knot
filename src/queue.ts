import { Queue, Worker } from 'bullmq';
import { prisma } from './db';
import { redis } from './redis';

export const embeddingQueue = new Queue('news_embedding_queue', { connection: redis });
export const clusterQueue = new Queue('cluster_queue', { connection: redis });
