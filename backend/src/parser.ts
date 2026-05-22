import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage } from 'telegram/events';
import { cleanText } from './cleaner';
import { prisma } from './db';
import { redis } from './redis';
import { config, getActiveChannels } from './config';
import { embeddingQueue } from './queue';
import * as crypto from 'crypto';

import { telegramClient } from './telegramClient';

export class TelegramParser {
    private client = telegramClient;
    private channelMap: Record<string, string> = {};

    constructor() { }

    async start() {
        await this.client.connect();
        console.log('Connected to Telegram');

        // Инициализируем стейт обновлений — критично для userbot-сессий
        await this.client.getDialogs({ limit: 1 });

        const activeChannels = await getActiveChannels();

        for (const channel of activeChannels) {
            try {
                const entity: any = await this.client.getEntity(channel);
                try {
                    await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
                } catch (_) { /* уже подписаны */ }
                console.log(`[Init] Ready: ${channel} (id=${entity.id})`);
            } catch (err: any) {
                console.error(`[Init] Could not resolve channel ${channel}:`, err.message);
            }
        }

        // Event handler — ловит сообщения из маленьких/собственных каналов (если Telegram пришлёт push)
        this.client.addEventHandler(
            (event: any) => this.handleNewMessage(event, false),
            new NewMessage({ chats: activeChannels })
        );
        console.log(`[Parser] Listening for new posts in: ${activeChannels.join(', ')}`);

        // Поллер — надёжный механизм для крупных публичных каналов.
        // Telegram намеренно НЕ рассылает push-уведомления userbot-сессиям от мега-каналов.
        // Дедупликация идёт по message.id (не по тексту), поэтому редактирование поста — не проблема.
        const POLL_INTERVAL_MS = 60_000; // 1 минута
        console.log(`[Poller] Starting — poll every ${POLL_INTERVAL_MS / 1000}s`);
        setInterval(async () => {
            const channelsToPoll = await getActiveChannels();
            for (const channelStr of channelsToPoll) {
                try {
                    const messages = await this.client.getMessages(channelStr, { limit: 3 });
                    for (const msg of messages) {
                        if (!msg.text && !msg.message) continue;
                        await this.handleNewMessage({ message: msg }, false);
                    }
                } catch (err: any) {
                    // Можем получить FloodWait — молча пропускаем
                    if (!err.message?.includes('FLOOD')) {
                        console.error(`[Poller] Error for ${channelStr}:`, err.message);
                    }
                }
            }
        }, POLL_INTERVAL_MS);

        // --- Интеллектуальная синхронизация при старте ---
        console.log('[Sync] Checking for missed messages...');
        const syncChannels = await getActiveChannels();
        for (const channelStr of syncChannels) {
            try {
                const entity: any = await this.client.getEntity(channelStr);
                const numericId = entity.id.toString().replace('-100', '').replace('-', '');
                const username = channelStr.replace('@', '');
                this.channelMap[numericId] = username;

                const cursorKey = `news:cursor:${username}`;
                const lastId = await redis.get(cursorKey);

                let messages = [];
                if (lastId) {
                    // Тянем всё, что пропустили с последнего запуска (max 100 за раз)
                    messages = await this.client.getMessages(channelStr, {
                        minId: parseInt(lastId),
                        limit: 100
                    });
                    if (messages.length > 0) {
                        console.log(`[Sync] Found ${messages.length} missed messages in ${channelStr}`);
                    }
                } else {
                    // Первый запуск — тянем последние 20
                    messages = await this.client.getMessages(channelStr, { limit: 20 });
                }

                for (const msg of messages) {
                    // Перенаправляем в handleNewMessage
                    await this.handleNewMessage({ message: msg }, true);
                }
                console.log(`[Sync] Finished sync for ${channelStr}`);
            } catch (err: any) {
                console.error(`[Sync] Failed for ${channelStr}:`, err.message);
            }
        }
        console.log('[Sync] Synchronization completed!');
    }

    private async handleNewMessage(event: any, isHistorical = false) {
        try {
            const message = event.message;
            if (!message) return;

            // --- Извлекаем текст (сообщение, подпись к фото или текст репоста) ---
            let raw_text = message.message || message.text || "";

            // Если это репост и основного текста нет, пробуем взять текст оригинала
            if (!raw_text && message.fwdFrom) {
                // В GramJS fwdFrom содержит метаданные, но само сообщение часто пушится с текстом
                // Если текста всё равно нет, GramJS может не подтянуть его без доп. запроса getMessages
            }

            const normalized_text = cleanText(raw_text);

            // Если текста совсем мало, возможно это рекламная кнопка или чистая картинка
            if (!normalized_text || normalized_text.length < 20) return;

            // --- Извлекаем channel_id ---
            let channel_id = 'unknown';
            if (message.peerId) {
                if (message.peerId.className === 'PeerChannel') {
                    channel_id = message.peerId.channelId?.toString() || 'unknown';
                } else if (message.peerId.className === 'PeerChat') {
                    channel_id = message.peerId.chatId?.toString() || 'unknown';
                } else if (message.peerId.className === 'PeerUser') {
                    channel_id = message.peerId.userId?.toString() || 'unknown';
                }
            } else if (event.chatId) {
                channel_id = event.chatId.toString().replace('-100', '');
            }
            channel_id = channel_id.replace('-100', '').replace('-', '');

            // Convert numeric ID to public username if we have it mapped!
            if (this.channelMap[channel_id]) {
                channel_id = this.channelMap[channel_id];
            }

            const external_id = BigInt(message.id);
            const grouped_id = message.groupedId ? message.groupedId.toString() : null;

            // --- Дедупликация по external_id + channel_id ---
            const dedupKey = `news:msg:${channel_id}:${external_id}`;
            const alreadySeen = await redis.get(dedupKey);
            if (alreadySeen) {
                if (isHistorical) console.log(`[Deduplication] Msg ${external_id} from ${channel_id} already processed.`);
                return;
            }

            // --- Дополнительная дедупликация альбомов (media groups) ---
            if (grouped_id) {
                const groupKey = `news:group:${channel_id}:${grouped_id}`;
                const groupSeen = await redis.get(groupKey);
                if (groupSeen) return;
                await redis.setex(groupKey, 3600, '1');
            }

            // Хэш текста нужен только для поля в БД (не для дедупа)
            const message_hash = crypto.createHash('sha256').update(normalized_text).digest('hex');

            if (!isHistorical) {
                console.log(`[Event] New post from channel: ${channel_id}, msg_id: ${external_id}`);
            }

            // --- Извлекаем медиа (фото/видео) ---
            const mediaRefs: string[] = [];
            if (message.media) {
                if (message.media instanceof Api.MessageMediaPhoto && message.media.photo instanceof Api.Photo) {
                    mediaRefs.push(JSON.stringify({
                        type: 'photo',
                        id: message.media.photo.id.toString(),
                        accessHash: message.media.photo.accessHash.toString(),
                        fileReference: message.media.photo.fileReference.toString('hex')
                    }));
                } else if (message.media instanceof Api.MessageMediaDocument && message.media.document instanceof Api.Document) {
                    mediaRefs.push(JSON.stringify({
                        type: 'doc',
                        id: message.media.document.id.toString(),
                        accessHash: message.media.document.accessHash.toString(),
                        fileReference: message.media.document.fileReference.toString('hex')
                    }));
                }
            }

            // --- Сохраняем в БД ---
            const createdItem = await prisma.newsItem.create({
                data: {
                    external_id,
                    channel_id,
                    raw_text,
                    normalized_text,
                    message_hash,
                    media: mediaRefs
                }
            });

            // Помечаем как обработанное в Redis на 7 дней
            await redis.setex(dedupKey, 604800, '1');

            // Обновляем курсор "последнего обработанного ID" для этого канала для синхронизации
            const cursorKey = `news:cursor:${channel_id}`;
            const currentCursor = await redis.get(cursorKey);
            if (!currentCursor || external_id > BigInt(currentCursor)) {
                await redis.set(cursorKey, external_id.toString());
            }

            console.log(`[Saved] Msg ${external_id} from channel ${channel_id} → item #${createdItem.id}`);

            // --- Добавляем в очередь векторизации ---
            await embeddingQueue.add('embed', { id: createdItem.id }, {
                attempts: 10,
                backoff: { type: 'exponential', delay: 1000 }
            });

        } catch (e: any) {
            if (e.code === 'P2002') {
                // Unique constraint — уже есть в БД, ставим метку в Redis чтобы не пытаться снова
                const external_id = event?.message?.id;
                if (external_id) {
                    let channel_id = 'unknown';
                    if (event?.message?.peerId?.channelId) channel_id = event.message.peerId.channelId.toString();
                    await redis.setex(`news:msg:${channel_id}:${external_id}`, 604800, '1');
                }
                if (!isHistorical) console.log(`[Deduplication] Already in DB, skipped.`);
            } else {
                console.error('[Error]', e.message || e);
            }
        }
    }
}
