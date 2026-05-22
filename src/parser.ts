import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { cleanText, getHash } from './cleaner';
import { prisma } from './db';
import { redis } from './redis';
import { config } from './config';
import { embeddingQueue } from './queue';

export class TelegramParser {
    private client: TelegramClient;

    constructor() {
        this.client = new TelegramClient(
            new StringSession(config.sessionString),
            config.apiId,
            config.apiHash,
            { connectionRetries: 5 }
        );
    }

    async start() {
        await this.client.connect();
        console.log('Connected to Telegram');

        const resolvedChats = [];
        for (const channel of config.targetChannels) {
            try {
                const entity: any = await this.client.getEntity(channel);
                // For proper event filtering, passing the resolved entity itself is best.
                // However, we also add the username/channel string as fallback.
                resolvedChats.push(entity.id); // original

                // For channels, gramjs often expects the bigInt ID to have the '-100' prefix.
                // Or simply passing the raw string so gramjs matches it via its internal cache.
                resolvedChats.push(channel);
                if (entity.className === 'Channel') {
                    resolvedChats.push(BigInt(`-100${entity.id.toString()}`));
                }

                console.log(`[Init] Resolved channel ${channel} to ID ${entity.id}`);
            } catch (err: any) {
                console.error(`[Init] Could not resolve channel ${channel}:`, err.message);
                resolvedChats.push(channel);
            }
        }

        this.client.addEventHandler(this.handleNewMessage.bind(this), new NewMessage({
            chats: resolvedChats,
        }));

        console.log(`Listening for messages on channels: ${config.targetChannels.join(', ')}`);

        // --- Ретроспективный сбор (Историческая Синхронизация) ---
        console.log('[Sync] Starting historical sync for the last 20 messages in each channel...');
        for (const channelStr of config.targetChannels) {
            try {
                // Fetch the 20 most recent messages
                const messages = await this.client.getMessages(channelStr, { limit: 20 });
                let newCount = 0;
                for (const msg of messages) {
                    if (!msg.text) continue;
                    // Mock the event object so it fits handleNewMessage structure
                    await this.handleNewMessage({ message: msg }, true); // Pass true to silence duplicate errors
                }
                console.log(`[Sync] Finished fetching history for ${channelStr}`);
            } catch (err: any) {
                console.error(`[Sync] Failed to fetch history for ${channelStr}:`, err.message);
            }
        }
        console.log('[Sync] Historical sync completed!');
    }

    private async handleNewMessage(event: any, isHistorical = false) {
        try {
            const message = event.message;
            if (!message.text) return;

            const raw_text = message.text;
            const normalized_text = cleanText(raw_text);

            if (!normalized_text || normalized_text.length < 30) {
                // Ignore too short messages (reactions, links only, short replies) to save Ollama GPU resources
                return;
            }

            const message_hash = getHash(normalized_text);

            // Check redis (24h TTL)
            const exists = await redis.get(`news:hash:${message_hash}`);
            if (exists) {
                console.log(`[Deduplication] Message hash ${message_hash} already processed.`);
                return;
            }

            const external_id = BigInt(message.id);

            let channel_id = 'unknown';
            if (message.peerId) {
                if (message.peerId.className === 'PeerChannel') {
                    channel_id = message.peerId.channelId?.toString() || 'unknown';
                } else if (message.peerId.className === 'PeerChat') {
                    channel_id = message.peerId.chatId?.toString() || 'unknown';
                } else if (message.peerId.className === 'PeerUser') {
                    channel_id = message.peerId.userId?.toString() || 'unknown';
                }
            }

            // Save to db
            const createdItem = await prisma.newsItem.create({
                data: {
                    external_id,
                    channel_id,
                    raw_text,
                    normalized_text,
                    message_hash,
                }
            });

            // Save to redis
            await redis.setex(`news:hash:${message_hash}`, 86400, '1'); // 24 hours

            console.log(`[Saved] Message ${external_id} from channel ${channel_id} saved.`);

            // Add to vectorization queue
            await embeddingQueue.add('embed', { id: createdItem.id }, {
                attempts: 10,
                backoff: { type: 'exponential', delay: 1000 }
            });
            console.log(`[Queue] Added item ${createdItem.id} to embedding queue`);

        } catch (e: any) {
            // Prisma throws P2002 on unique constraint fail (hash exists in DB but expired in Redis)
            if (e.code === 'P2002') {
                if (!isHistorical) console.log(`[Deduplication] Message silently ignored. Hash already in PostgreSQL.`);
            } else {
                console.error('[Error processing message]', e.message || e);
            }
        }
    }
}
