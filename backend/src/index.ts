import { TelegramParser } from './parser';
import './worker'; // start worker
import { clusterQueue } from './queue';
import { startBot } from './bot';

async function main() {
    console.log('Starting News Aggregation Pipeline...');

    startBot(); // Запускаем бота-модератора

    // Schedule clustering job every 15 minutes
    await clusterQueue.add('cluster_task', {}, {
        repeat: {
            pattern: '*/5 * * * *'
        }
    });
    console.log('Scheduled clustering cron job via BullMQ');
    const parser = new TelegramParser();

    while (true) {
        try {
            await parser.start();
            console.log('[System] Heartbeat: Pipeline is active and listening...');
            // Бесконечный цикл ожидания с пульсом
            while (true) {
                await new Promise(resolve => setTimeout(resolve, 300000));
                console.log('[System] Heartbeat: Pipeline is still running...');
            }
        } catch (err: any) {
            console.error(`[Fatal] Parser crashed: ${err.message}. Restarting in 10s...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

import { startDashboard } from './dashboard';

// Глобальные обработчики для стабильности
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Fatal] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('[Fatal] Uncaught Exception:', err);
});

startDashboard();
main().catch(err => {
    console.error('[Main] Top-level error:', err);
    process.exit(1);
});
