import { prisma } from './db';
import { clusterize } from './clusterizer';

async function test() {
    console.log('Resetting clusters...');
    await prisma.newsItem.updateMany({ data: { cluster_id: null } });
    await prisma.newsCluster.deleteMany({});
    
    console.log('Manually triggering clusterizer for testing purposes...');
    await clusterize();

    console.log('\n--- алидация: ластеры, где 2 и более новостей ---');
    const clusters = await prisma.newsCluster.findMany({
        where: { news_count: { gte: 2 } },
        include: { items: { select: { id: true, channel_id: true } } }
    });

    console.dir(clusters, { depth: null });
    process.exit(0);
}
test().catch(console.error);
