import { Telegraf } from 'telegraf';
import { finalizePublication } from './generator';

import { prisma } from './db';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

// Канал, куда пойдут одобренные посты
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || '';

export function startBot() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.warn('[Bot] No token provided, bot not started');
        return;
    }

    bot.start(async (ctx) => {
        const telegram_id = ctx.from.id.toString();
        try {
            await prisma.subscriber.upsert({
                where: { telegram_id },
                update: {},
                create: { telegram_id }
            });
            ctx.reply('Привет! Теперь ты подписан на дайджест новостей. Я буду присылать черновики прямо сюда.');
        } catch (e) {
            console.error('[Bot] Error saving subscriber:', e);
            ctx.reply('Произошла ошибка при подписке.');
        }
    });

    bot.on('callback_query', async (ctx: any) => {
        const data = ctx.callbackQuery.data;
        const [action, clusterId] = data.split('_');

        if (action === 'pub') {
            await ctx.answerCbQuery('Публикую...');
            await finalizePublication(parseInt(clusterId), TARGET_CHANNEL_ID);
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ **ОПУБЛИКОВАНО**', { parse_mode: 'Markdown' });
        } else if (action === 'rej') {
            await ctx.answerCbQuery('Отклонено');
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ **ОТКЛОНЕНО**', { parse_mode: 'Markdown' });
        }
    });

    bot.launch()
        .then(() => console.log('[Bot] Approval bot is running'))
        .catch(err => console.error('[Bot] Failed to start:', err));

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
