import { AuthConfig, type AuthRateLimits } from './auth.config.js';
import { AuthHttpError } from './auth.errors.js';
import { AuthRepository, type RateLimitInput } from './auth.repository.js';

/** Admission commits independently of delivery/business work, and is never refunded. */
export class AuthRateLimiter {
  constructor(private readonly repository: AuthRepository, private readonly config: AuthConfig) {}

  async admit(dimensions: ReadonlyArray<readonly [keyof AuthRateLimits, string]>): Promise<void> {
    this.config.assertAvailable();
    for (const [dimension, identifier] of dimensions) {
      const scope: RateLimitInput['scope'] = dimension.startsWith('request') ? 'otp-challenge' :
        dimension.startsWith('verify') ? 'otp-verification' : 'session';
      for (const budget of this.config.rateLimits[dimension]) {
        const now = this.config.now();
        const windowStart = new Date(Math.floor(now.getTime() / budget.windowMs) * budget.windowMs);
        const expiresAt = new Date(windowStart.getTime() + budget.windowMs);
        let allowed: boolean;
        try {
          allowed = await this.repository.useRateLimit({
            bucketKey: this.config.mac.rateLimitDigest(`${dimension}:${budget.windowMs}`, identifier),
            scope, windowStart, expiresAt, limit: budget.limit,
          }, () => this.config.now());
        } catch { throw new AuthHttpError('AUTH_UNAVAILABLE'); }
        if (!allowed) throw new AuthHttpError('AUTH_THROTTLED', Math.max(1, Math.ceil((expiresAt.getTime() - this.config.now().getTime()) / 1_000)));
      }
    }
  }
}
