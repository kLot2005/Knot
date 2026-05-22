import 'dotenv/config';
import { prisma } from './db';

export const config = {
    apiId: parseInt(process.env.API_ID || '0', 10),
    apiHash: process.env.API_HASH || '',
    sessionString: process.env.TELEGRAM_SESSION || '',
    dbUrl: process.env.DATABASE_URL || '',
    redisUrl: process.env.REDIS_URL || '',
    targetChannelsEnv: (process.env.TARGET_CHANNELS || '').split(',').map((c: string) => c.trim()).filter(Boolean),
};

/**
 * Возвращает список активных каналов из БД. 
 * Если БД пуста — переносит список из .env в БД (одноразовая миграция).
 */
export async function getActiveChannels(): Promise<string[]> {
    let channels = await prisma.sourceChannel.findMany({
        where: { is_active: true }
    });

    if (channels.length === 0 && config.targetChannelsEnv.length > 0) {
        console.log('[Config] Seeding channels from .env to Database...');
        for (const username of config.targetChannelsEnv) {
            await prisma.sourceChannel.upsert({
                where: { username },
                update: {},
                create: { username, is_active: true }
            });
        }
        channels = await prisma.sourceChannel.findMany({
            where: { is_active: true }
        });
    }

    return channels.map((c: any) => c.username.startsWith('@') ? c.username : `@${c.username}`);
}
