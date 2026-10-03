import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { UsersRepository } from './users.repository.js';

@Module({ imports: [DatabaseModule], providers: [UsersRepository], exports: [UsersRepository] })
export class UsersModule {}
