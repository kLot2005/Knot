import { prisma } from './db';
import { embeddingQueue } from './queue';

async function testEmbedding() {
    console.log('1. Creating a synthetic news item for testing...');
    const testItem = await prisma.newsItem.create({
        data: {
            external_id: BigInt(Date.now()),
            channel_id: 'test_validation_channel',
            raw_text: 'Ollama это отличный инструмент для векторизации текста!',
            normalized_text: 'Ollama это отличный инструмент для векторизации текста!',
            message_hash: 'test_hash_' + Date.now(),
        }
    });

    console.log(`[Item Created] ID: ${testItem.id}`);

    console.log('2. Pushing to embedding queue...');
    await embeddingQueue.add('embed', { id: testItem.id });

    console.log('3. Waiting for worker to process (checking DB every 2 seconds)...');

    // Poll the database to see if embedding was added
    for (let i = 0; i < 30; i++) {
        await new Promise(res => setTimeout(res, 2000));

        // We must use raw query to fetch vector dimensionality
        const result: any = await prisma.$queryRaw`SELECT vector_dims(embedding) as dim, embedding::text FROM news_items WHERE id = ${testItem.id}`;

        if (result && result.length > 0 && result[0].dim !== null) {
            console.log(`\n✅ Успех! Вектор успешно сгенерирован и сохранен!`);
            console.log(`Размерность вектора: ${result[0].dim}`);

            // Slice the string logic just to show the first few floats
            const vectorStr = result[0].embedding;
            console.log(`Пример вектора: ${vectorStr.substring(0, 50)}...`);
            process.exit(0);
        }
        process.stdout.write('.');
    }

    console.log('\n❌ Тайм-аут: Вектор так и не появился в БД. Убедитесь, что worker запущен (npm start).');
    process.exit(1);
}

testEmbedding().catch(console.error);
