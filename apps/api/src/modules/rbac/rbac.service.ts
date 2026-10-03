import { Injectable } from '@nestjs/common';
import { RbacRepository } from './rbac.repository.js';

export function isCapabilityKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && /^[a-z][a-z0-9]*(?:[.:-][a-z][a-z0-9]*)+$/.test(value);
}

@Injectable()
export class RbacService {
  constructor(private readonly repository: RbacRepository) {}

  async permits(userId: string, capability: unknown): Promise<boolean> {
    if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || !isCapabilityKey(capability)) return false;
    return this.repository.hasCapability(userId, capability);
  }
}
