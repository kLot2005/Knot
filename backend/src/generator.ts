import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "./db";
import { telegramClient } from "./telegramClient";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MODERATOR_CHAT_ID = process.env.PUBLISH_CHAT_ID;

// Функция для безопасного экранирования HTML
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

    if (!cluster || cluster.items.length < 2 || cluster.is_processed) return;

    console.log(`[Synthesis] Generating digest for editor (Cluster #${clusterId})...`);

    const texts = cluster.items.map((it, idx) => `[Post ${idx + 1} from ${it.channel_id}]: ${it.normalized_text}`).join('\n\n');
    const prompt = `Твоя задача — превращать новости в посты для Telegram. Стиль: живой, лаконичный. Сначала хук, потом факты, в конце ирония.\n\n${texts}`;

    try {
        console.log(`[Synthesis] Requesting Gemini AI...`);
        const result = await model.generateContent(prompt);
        const synthesizedText = result.response.text();

        if (!synthesizedText) throw new Error("Gemini returned empty response");

        // Формируем красивый HTML для редактора
        const escapedSynth = escapeHtml(synthesizedText);
        const links = cluster.items.map(it => `• <a href="https://t.me/${it.channel_id}/${it.external_id}">Пост из ${it.channel_id}</a>`).join('\n');

        const htmlMessage = `
<b>📝 СГЕНЕРИРОВАННЫЙ ЧЕРНОВИК</b>
_______________________________

${escapedSynth}

🔗 <b>ИСХОДНЫЕ МАТЕРИАЛЫ:</b>
${links}
        `;

        if (BOT_TOKEN) {
            const subscribers = await prisma.subscriber.findMany();
            console.log(`[Synthesis] Sending digest to ${subscribers.length} subscribers...`);

            for (const sub of subscribers) {
                const chatId = sub.telegram_id;
                try {
                    // Пересылаем медиа
                    for (const item of cluster.items) {
                        try {
                            const messages = await telegramClient.getMessages(item.channel_id, {
                                ids: [Number(item.external_id)]
                            });
                            const msg = messages[0];
                            if (msg && msg.media) {
                                const buffer = await telegramClient.downloadMedia(msg.media);
                                if (buffer instanceof Buffer) {
                                    const formData = new FormData();
                                    formData.append('chat_id', chatId);
                                    const blob = new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' });
                                    formData.append('photo', blob, 'photo.jpg');
                                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: formData });
                                    break;
                                }
                            }
                        } catch (e) { }
                    }

                    // Отправляем основной текст
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: htmlMessage,
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        })
                    });
                } catch (err: any) {
                    console.error(`[Synthesis] Failed to send to sub ${chatId}:`, err.message);
                }
            }
            console.log(`[Synthesis] Digest distribution completed.`);
        }

        await prisma.newsCluster.update({
            where: { id: clusterId },
            data: { is_processed: true }
        });

        await prisma.generatedPost.create({
            data: {
                cluster_id: clusterId,
                text: synthesizedText
            }
        });

        return true;
    } catch (err: any) {
        console.error(`[Synthesis] Error:`, err.message);
        return false;
    }
}

// Функцию публикации в канал мы оставляем в коде, но бот ее больше сам не вызывает.
export async function finalizePublication(clusterId: number, targetChannelId: string) {
    const gen = await prisma.generatedPost.findUnique({
        where: { cluster_id: clusterId },
        include: { cluster: { include: { items: true } } }
    });
    if (!gen) return;

    const escapedText = escapeHtml(gen.text);
    const links = gen.cluster.items.map(it => `• <a href="https://t.me/${it.channel_id}/${it.external_id}">Источник</a>`).join('\n');

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: targetChannelId,
            text: `${escapedText}\n\n🔗 <b>Источники:</b>\n${links}`,
            parse_mode: 'HTML'
        })
    });
}
