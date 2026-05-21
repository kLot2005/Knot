import 'dotenv/config';

export const config = {
    apiId: parseInt(process.env.API_ID || '0', 10),
    apiHash: process.env.API_HASH || '',
    sessionString: process.env.TELEGRAM_SESSION || '',
    dbUrl: process.env.DATABASE_URL || '',
    redisUrl: process.env.REDIS_URL || '',
    targetChannels: (process.env.TARGET_CHANNELS || '').split(',').map((c: string) => c.trim()).filter(Boolean),
};
