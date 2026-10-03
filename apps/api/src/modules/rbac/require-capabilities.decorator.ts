import { SetMetadata } from '@nestjs/common';
import { isCapabilityKey } from './rbac.service.js';

export const REQUIRED_CAPABILITY = Symbol('rahrow.required-capability');

/** Exactly one requirement; no implicit multi-capability AND/OR semantics. */
export function RequireCapability(capability: string) {
  if (!isCapabilityKey(capability)) throw new Error('Invalid capability requirement.');
  return SetMetadata(REQUIRED_CAPABILITY, capability);
}
