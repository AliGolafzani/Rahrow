import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';

@Module({ imports: [DatabaseModule], providers: [AuthRepository, AuthService], exports: [AuthService] })
export class AuthModule {}
