import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { cleanText, getHash } from './cleaner';
import { prisma } from './db';
import { redis } from './redis';
import { config } from './config';

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
                const entity = await this.client.getEntity(channel);
                resolvedChats.push(entity.id);
                console.log(`[Init] Resolved channel ${channel} to ID ${entity.id}`);
            } catch (err: any) {
                console.error(`[Init] Could not resolve channel ${channel}:`, err.message);
                resolvedChats.push(channel); // fallback
            }
        }

        this.client.addEventHandler(this.handleNewMessage.bind(this), new NewMessage({
            chats: resolvedChats,
        }));

        console.log(`Listening for messages on channels: ${config.targetChannels.join(', ')}`);
    }

    private async handleNewMessage(event: any) {
        try {
            const message = event.message;
            if (!message.text) return;

            const raw_text = message.text;
            const normalized_text = cleanText(raw_text);

            if (!normalized_text) return;

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
            await prisma.newsItem.create({
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

        } catch (e) {
            console.error('[Error processing message]', e);
        }
    }
}
