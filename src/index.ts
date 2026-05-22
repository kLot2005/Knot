import { TelegramParser } from './parser';
import './worker'; // start worker
import { clusterQueue } from './queue';

async function main() {
    console.log('Starting News Aggregation Pipeline...');

    // Schedule clustering job every 15 minutes
    await clusterQueue.add('cluster_task', {}, {
        repeat: {
            pattern: '*/15 * * * *'
        }
    });
    console.log('Scheduled clustering cron job via BullMQ');
    const parser = new TelegramParser();
    await parser.start();
}

import { startDashboard } from './dashboard';
startDashboard();
main().catch(console.error);
