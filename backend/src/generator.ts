import { Api } from "telegram";
import { prisma } from "./db";
import { telegramClient } from "./telegramClient";

// Конфигурация Ollama
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api';
const OLLAMA_MODEL = 'gemma3:4b';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export async function synthesizeCluster(clusterId: number) {
    const cluster = await prisma.newsCluster.findUnique({
        where: { id: clusterId },
        include: { items: { orderBy: { created_at: 'asc' } } }
    });

    if (!cluster || cluster.items.length < 3 || cluster.is_processed) return;

    console.log(`[Synthesis] Processing Cluster #${clusterId} (${cluster.items.length} items)`);

    const texts = cluster.items.map((it, idx) => `[Источник ${idx + 1}]: ${it.normalized_text}`).join('\n\n');

    // Вставляем ваш последний уточненный промпт
    const prompt = `Сухие новости для анализа будут переданы в конце. В тексте может быть массив из нескольких разных новостей, но твоя задача — выбрать только ОДИН, самый важный, громкий или актуальный для Казахстана инфоповод и написать по нему короткий пост. Остальные темы полностью игнорируй. В одном посте строго запрещено смешивать разные новости.

### Твоя Роль
Ты — редактор Telegram-канала нового поколения. Твой стиль — ультра-минимализм, хлесткость и скорость. Ты не размазываешь мысль, а бьешь фактом прямо в цель. Читатель должен считывать пост за 5–10 секунд.

### Точные Правила Стиля (ToV)
1. Объем: Строго от 2 до 4 предложений. Никакой «воды» и лишних рассуждений.
2. Язык: Живой, естественный разговорный русский язык (как общаются современные жители Алматы и Астаны). 
3. Фильтр безопасности (КРИТИЧЕСКИ ВАЖНО): 
   * Если новость абсурдная или бытовая — включай тонкую, ироничную подачу. 
   * Если новость трагическая (ДТП с жертвами, криминал, катастрофы) — ЛЮБАЯ ИРОНИЯ ЗАПРЕЩЕНА. Пиши сухо, уважительно, емко и строго по фактам. Не пытайся шутить на крови.

### Структура и Форматирование
* Пост должен состоять из 1 или максимум 2 очень коротких абзацев.
* Первая строка (Хук): Начинай сразу с сути. Самая важная фраза или главный факт ОБЯЗАТЕЛЬНО выделяется жирным шрифтом. Строгие, сухие заголовки запрещены.
* Финал: Пост заканчивается либо короткой реакцией/выводом, либо одним точечным эмодзи.
* Эмодзи: Строго 1 штука на весь пост (в самом конце) для визуального акцента (например: 💸, 🛑, 🤡). Больше одного эмодзи использовать запрещено.

### ЖЕСТКИЕ ЗАПРЕТЫ (АНТИ-КРИНЖ ФИЛЬТР)
1. Вывод: Выдавай СТРОГО только текст готового поста. Запрещено писать вводные фразы («Окей, вот пост:», «Держите вариант:»), использовать кавычки в начале и конце поста или оставлять комментарии после текста. Только чистый контент для публикации.
2. Черный список слов (БАН): Никогда не используй искусственные разговорные штампы: «жб», «братан», «таки вот», «ну, привет, народ», «ага, как будто». Пиши нативно.
3. Полный бан на хэштеги: Никаких #Алматы, #ДТП, #Свойский в конце поста. Хэштеги запрещены.
4. Полный бан на списки: Никаких перечислений через 1️⃣, 2️⃣ или буллиты (🔹). Весь текст — это связные 2-4 предложения.
5. Без канцеляризмов: Переводи фразы вроде «осуществляется ремонт» на «дороги перекопали», а «в целях профилактики» на «для галочки».

НОВОСТИ ДЛЯ АНАЛИЗА:
${texts}

ТЕЛЕГРАМ-ПОСТ:`;

    try {
        const response = await fetch(`${OLLAMA_URL}/generate`, {
            method: 'POST',
            body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false })
        });

        if (!response.ok) throw new Error(`Ollama failed: ${response.statusText}`);
        const data: any = await response.json();
        const synthesizedText = data.response?.trim();
        if (!synthesizedText) throw new Error("Empty AI response");

        // Кэшируем медиа (до 5 файлов)
        const mediaToGroup: { buffer: Buffer; isVideo: boolean }[] = [];
        for (const item of cluster.items.slice(0, 5)) {
            try {
                const messages = await telegramClient.getMessages(item.channel_id, { ids: [Number(item.external_id)] });
                const msg = messages[0];
                if (msg && msg.media) {
                    const buffer = await telegramClient.downloadMedia(msg.media);
                    if (buffer instanceof Buffer) {
                        let isVideo = false;
                        if (msg.media instanceof Api.MessageMediaDocument && msg.media.document) {
                            const doc = msg.media.document as Api.Document;
                            if (doc.mimeType?.includes('video')) isVideo = true;
                        }
                        mediaToGroup.push({ buffer, isVideo });
                    }
                }
            } catch (e) { }
        }

        const escapedSynth = escapeHtml(synthesizedText);
        const links = cluster.items.map(it => `• <a href="https://t.me/${it.channel_id}/${it.external_id}">Источник ${it.channel_id}</a>`).join('\n');
        const finalHtml = `${escapedSynth}\n\n🔗 <b>Материалы:</b>\n${links}`;

        const subscribers = await prisma.subscriber.findMany();
        if (BOT_TOKEN && subscribers.length > 0) {
            await Promise.all(subscribers.map(async (sub) => {
                try {
                    for (const m of mediaToGroup) {
                        const formData = new FormData();
                        formData.append('chat_id', sub.telegram_id);
                        const blob = new Blob([new Uint8Array(m.buffer)], { type: m.isVideo ? 'video/mp4' : 'image/jpeg' });
                        formData.append(m.isVideo ? 'video' : 'photo', blob, m.isVideo ? 'video.mp4' : 'photo.jpg');
                        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${m.isVideo ? 'sendVideo' : 'sendPhoto'}`, { method: 'POST', body: formData });
                    }
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: sub.telegram_id, text: finalHtml, parse_mode: 'HTML', disable_web_page_preview: true })
                    });
                } catch (e) { }
            }));
        }

        await prisma.$transaction([
            prisma.newsCluster.update({ where: { id: clusterId }, data: { is_processed: true } }),
            prisma.generatedPost.create({ data: { cluster_id: clusterId, text: synthesizedText } })
        ]);

        return true;
    } catch (err: any) {
        console.error(`[Synthesis] Error:`, err.message);
        throw err;
    }
}

export async function finalizePublication(clusterId: number, targetChannelId: string) {
    const gen = await prisma.generatedPost.findUnique({ where: { cluster_id: clusterId }, include: { cluster: { include: { items: true } } } });
    if (!gen) return;

    const escapedText = escapeHtml(gen.text);
    const links = gen.cluster.items.map(it => `• <a href="https://t.me/${it.channel_id}/${it.external_id}">Источник</a>`).join('\n');

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChannelId, text: `${escapedText}\n\n🔗 <b>Источники:</b>\n${links}`, parse_mode: 'HTML' })
    });
}
