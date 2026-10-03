import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

/** Lazy connection: importing modules never connects or applies migrations. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private instance: PrismaClient | undefined;

  get client(): PrismaClient {
    if (!this.instance) {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) throw new Error('Database configuration is unavailable.');
      this.instance = new PrismaClient({
        adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 }),
        log: [],
      });
    }
    return this.instance;
  }

  async onModuleDestroy(): Promise<void> {
    await this.instance?.$disconnect();
  }
}
