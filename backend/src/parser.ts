import { Api } from 'telegram';
import { NewMessage } from 'telegram/events';
import { cleanText } from './cleaner';
import { prisma } from './db';
import { redis } from './redis';
import { getActiveChannels } from './config';
import { embeddingQueue } from './queue';
import * as crypto from 'crypto';
import { telegramClient } from './telegramClient';

export class TelegramParser {
    private client = telegramClient;
    private channelMap: Record<string, string> = {};

    constructor() { }

    async start() {
        await this.client.connect();
        console.log('[Parser] Connected to Telegram');

        // Инициализируем диалоги для корректной работы обновлений
        await this.client.getDialogs({ limit: 1 });

        const activeChannels = await getActiveChannels();

        // 1. Быстрая инициализация сущностей каналов
        await Promise.all(activeChannels.map(async (channel) => {
            try {
                const entity: any = await this.client.getEntity(channel);
                const numericId = entity.id.toString().replace('-100', '').replace('-', '');
                const username = channel.replace('@', '');
                this.channelMap[numericId] = username;

                // Пробуем подписаться, если не подписаны
                try {
                    await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                } catch (e) { }

                console.log(`[Init] Channel ready: ${channel}`);
            } catch (err: any) {
                console.error(`[Init] Failed for ${channel}:`, err.message);
            }
        }));

        // Event handler для новых постов
        this.client.addEventHandler(
            (event: any) => this.handleNewMessage(event, false),
            new NewMessage({ chats: activeChannels })
        );

        // Поллер для надежности
        setInterval(async () => {
            const channels = await getActiveChannels();
            for (const ch of channels) {
                try {
                    const messages = await this.client.getMessages(ch, { limit: 5 });
                    for (const msg of messages) {
                        if (msg.message || msg.text) {
                            await this.handleNewMessage({ message: msg }, false);
                        }
                    }
                } catch (e) { }
            }
        }, 60000);

        // 2. Оптимизированная синхронизация при старте
        console.log('[Sync] Starting background synchronization...');
        this.runSync(activeChannels).catch(console.error);
    }

    private async runSync(channels: string[]) {
        for (const channelStr of channels) {
            try {
                const username = channelStr.replace('@', '');
                const cursorKey = `news:cursor:${username}`;
                const lastId = await redis.get(cursorKey);

                const messages = await this.client.getMessages(channelStr, {
                    minId: lastId ? parseInt(lastId) : undefined,
                    limit: lastId ? 100 : 20
                });

                if (messages.length > 0) {
                    console.log(`[Sync] Processing ${messages.length} missed messages from ${channelStr}`);
                    // Обрабатываем пачкой
                    for (const msg of messages) {
                        await this.handleNewMessage({ message: msg }, true);
                    }
                }
            } catch (err: any) {
                console.error(`[Sync] Error for ${channelStr}:`, err.message);
            }
        }
        console.log('[Sync] All channels synchronized.');
    }

    private async handleNewMessage(event: any, isHistorical = false) {
        try {
            const message = event.message;
            if (!message || (!message.message && !message.text)) return;

            const raw_text = message.message || message.text || "";
            const normalized_text = cleanText(raw_text);

            if (!normalized_text || normalized_text.length < 30) return;

            // Определяем ID канала
            let numeric_id = '';
            if (message.peerId?.channelId) numeric_id = message.peerId.channelId.toString();
            else if (event.chatId) numeric_id = event.chatId.toString();

            numeric_id = numeric_id.replace('-100', '').replace('-', '');
            const channel_id = this.channelMap[numeric_id] || numeric_id;

            const external_id = message.id;
            const grouped_id = message.groupedId ? message.groupedId.toString() : null;

            // Дедупликация
            const dedupKey = `news:msg:${channel_id}:${external_id}`;
            if (await redis.get(dedupKey)) return;

            if (grouped_id) {
                const groupKey = `news:group:${channel_id}:${grouped_id}`;
                if (await redis.get(groupKey)) return;
                await redis.setex(groupKey, 3600, '1');
            }

            const message_hash = crypto.createHash('sha256').update(normalized_text).digest('hex');

            // Сохраняем медиа-линки
            const mediaLinks: string[] = [];
            if (message.media) {
                // Сохраняем структуру для последующего скачивания
                mediaLinks.push(JSON.stringify(message.media));
            }

            const item = await prisma.newsItem.create({
                data: {
                    external_id: BigInt(external_id),
                    channel_id,
                    raw_text,
                    normalized_text,
                    message_hash,
                    media: mediaLinks
                }
            });

            await redis.setex(dedupKey, 604800, '1');

            // Обновляем курсор самого свежего сообщения
            await redis.set(`news:cursor:${channel_id}`, external_id.toString());

            if (!isHistorical) {
                console.log(`[Parser] New item #${item.id} from ${channel_id}`);
            }

            // В очередь на векторный эмбеддинг
            await embeddingQueue.add('embed', { id: item.id });

        } catch (e: any) {
            if (e.code === 'P2002') return; // Игнорируем дубли по базе
            console.error('[Parser Error]', e.message);
        }
    }
}
