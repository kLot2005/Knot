import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config';

const pool = new Pool({ connectionString: config.dbUrl });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter } as any);
