import { TelegramParser } from './parser';

async function main() {
    console.log('Starting News Aggregation Pipeline...');
    const parser = new TelegramParser();
    await parser.start();
}

main().catch(console.error);
