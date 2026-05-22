import { Queue } from 'bullmq';
import { redis } from './redis';

export const embeddingQueue = new Queue('embedding_queue', { connection: redis });
export const clusterQueue = new Queue('cluster_queue', { connection: redis });
export const synthesisQueue = new Queue('synthesis_queue', { connection: redis });
