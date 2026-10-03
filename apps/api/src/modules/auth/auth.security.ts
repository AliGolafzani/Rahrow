import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createSecretKey,
  hkdfSync,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { Buffer } from 'node:buffer';

const SCRYPT_PARAMETERS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const PASSWORD_PREFIX = 'scrypt$v1$131072$8$1';
const PASSWORD_MAX_BYTES = 4096;
const TOTP_MAX_BYTES = 1024;
const KEY_DERIVATION_SALT = 'rahrow:auth:key-derivation:v1';

/** Deliberately contains neither the rejected input nor an underlying crypto error. */
export class AuthSecurityError extends Error {
  constructor() {
    super('Authentication security operation failed.');
    this.name = 'AuthSecurityError';
  }
}

function requireBoundedString(value: unknown, maxBytes: number): asserts value is string {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > maxBytes ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new AuthSecurityError();
  }
}

function decodeBase64Url(value: unknown, minBytes: number, maxBytes: number): Buffer {
  if (
    typeof value !== 'string' || value.length === 0 ||
    value.length > Math.ceil(maxBytes * 4 / 3) || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new AuthSecurityError();
  }
  const result = Buffer.from(value, 'base64url');
  if (result.length < minBytes || result.length > maxBytes || result.toString('base64url') !== value) {
    throw new AuthSecurityError();
  }
  return result;
}

function decodeDigest(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length !== 64 || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new AuthSecurityError();
  }
  return Buffer.from(value, 'hex');
}

function derivePurposeKey(rootKey: unknown, purpose: string): KeyObject {
  if (!(rootKey instanceof Uint8Array) || rootKey.byteLength !== 32) {
    throw new AuthSecurityError();
  }
  const copy = Buffer.from(rootKey);
  let derived: Buffer | undefined;
  try {
    derived = Buffer.from(hkdfSync('sha256', copy, KEY_DERIVATION_SALT, purpose, 32));
    return createSecretKey(derived);
  } catch {
    throw new AuthSecurityError();
  } finally {
    copy.fill(0);
    derived?.fill(0);
  }
}

function derivePassword(password: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_PARAMETERS, (error, result) => {
      if (error) reject(new AuthSecurityError());
      else resolve(result);
    });
  });
}

/** Server-only admin credential primitive; this does not establish authentication assurance. */
export async function hashAdminPassword(password: string): Promise<string> {
  requireBoundedString(password, PASSWORD_MAX_BYTES);
  const bytes = Buffer.from(password, 'utf8');
  const salt = randomBytes(16);
  let derived: Buffer | undefined;
  try {
    derived = await derivePassword(bytes, salt);
    return `${PASSWORD_PREFIX}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
  } catch {
    throw new AuthSecurityError();
  } finally {
    bytes.fill(0);
    derived?.fill(0);
  }
}

/** Only the bounded v1 parameters are accepted; stored parameters cannot increase work. */
export async function verifyAdminPassword(password: string, encoded: unknown): Promise<boolean> {
  let bytes: Buffer | undefined;
  let expected: Buffer | undefined;
  let derived: Buffer | undefined;
  try {
    requireBoundedString(password, PASSWORD_MAX_BYTES);
    if (typeof encoded !== 'string' || encoded.length > 256) return false;
    const parts = encoded.split('$');
    if (parts.length !== 7 || parts.slice(0, 5).join('$') !== PASSWORD_PREFIX) return false;
    const salt = decodeBase64Url(parts[5], 16, 16);
    expected = decodeBase64Url(parts[6], 64, 64);
    bytes = Buffer.from(password, 'utf8');
    derived = await derivePassword(bytes, salt);
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  } finally {
    bytes?.fill(0);
    expected?.fill(0);
    derived?.fill(0);
  }
}

/** Representation only: no trimming, default country, locale parsing or eligibility decision. */
export function assertCanonicalMobile(value: unknown): string {
  if (
    typeof value !== 'string' || value.trim() !== value ||
    !/^\+[1-9][0-9]{0,14}$/u.test(value)
  ) {
    throw new AuthSecurityError();
  }
  return value;
}

export interface OtpContext {
  readonly challengeId: string;
  readonly targetDigest: string;
}

/** CSPRNG, including leading zeroes. Persistence, expiry and consumption belong to the repository. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Keys are private KeyObjects, with separate HKDF and message domains for every purpose. */
export class OtpMac {
  readonly #targetKey: KeyObject;
  readonly #codeKey: KeyObject;
  readonly #rateLimitKey: KeyObject;

  constructor(rootKey: Uint8Array) {
    this.#targetKey = derivePurposeKey(rootKey, 'rahrow:otp:target-digest:v1');
    this.#codeKey = derivePurposeKey(rootKey, 'rahrow:otp:code-verification:v1');
    this.#rateLimitKey = derivePurposeKey(rootKey, 'rahrow:auth:rate-limit-digest:v1');
  }

  targetDigest(mobile: string): string {
    return createHmac('sha256', this.#targetKey)
      .update(JSON.stringify(['rahrow:otp:target:v1', assertCanonicalMobile(mobile)]))
      .digest('hex');
  }

  codeMac(context: OtpContext, code: string): string {
    requireBoundedString(context?.challengeId, 128);
    decodeDigest(context?.targetDigest);
    if (typeof code !== 'string' || code.length !== 6 || !/^[0-9]{6}$/u.test(code)) {
      throw new AuthSecurityError();
    }
    return createHmac('sha256', this.#codeKey)
      .update(JSON.stringify(['rahrow:otp:code:v1', context.challengeId, context.targetDigest, code]))
      .digest('hex');
  }

  verifyCode(context: OtpContext, code: string, storedMac: unknown): boolean {
    try {
      const expected = decodeDigest(storedMac);
      const actual = decodeDigest(this.codeMac(context, code));
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }

  rateLimitDigest(scope: string, identifier: string): string {
    requireBoundedString(scope, 64);
    requireBoundedString(identifier, 512);
    return createHmac('sha256', this.#rateLimitKey)
      .update(JSON.stringify(['rahrow:auth:rate-limit:v1', scope, identifier]))
      .digest('hex');
  }
}

export interface TotpEnvelope {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authenticationTag: string;
  /** A lookup identifier only. Never store key material in this field. */
  readonly keyVersion: string;
}

export interface TotpCipherConfiguration {
  readonly activeKeyVersion: string;
  /** External key source. Returning no key fails closed; no fallback key is used. */
  readonly keyLookup: (keyVersion: string) => Uint8Array | undefined;
}

function requireKeyVersion(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' || value.length > 64 || value.trim() !== value ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  ) {
    throw new AuthSecurityError();
  }
}

/** Secret storage only. No TOTP algorithm, enrollment, replay-state mutation or admin login. */
export class TotpSecretCipher {
  readonly #activeKeyVersion: string;
  readonly #keyLookup: TotpCipherConfiguration['keyLookup'];

  constructor(configuration: TotpCipherConfiguration) {
    requireKeyVersion(configuration?.activeKeyVersion);
    if (typeof configuration.keyLookup !== 'function') throw new AuthSecurityError();
    this.#activeKeyVersion = configuration.activeKeyVersion;
    this.#keyLookup = configuration.keyLookup;
  }

  #key(version: string): KeyObject {
    requireKeyVersion(version);
    return derivePurposeKey(this.#keyLookup(version), 'rahrow:admin:totp-encryption:v1');
  }

  #aad(userId: string, keyVersion: string): Buffer {
    requireBoundedString(userId, 128);
    return Buffer.from(JSON.stringify(['rahrow:admin:totp-envelope:v1', userId, keyVersion]), 'utf8');
  }

  encrypt(userId: string, secret: Uint8Array): TotpEnvelope {
    let plaintext: Buffer | undefined;
    try {
      if (!(secret instanceof Uint8Array) || secret.byteLength === 0 || secret.byteLength > TOTP_MAX_BYTES) {
        throw new AuthSecurityError();
      }
      const nonce = randomBytes(12);
      const keyVersion = this.#activeKeyVersion;
      const cipher = createCipheriv('aes-256-gcm', this.#key(keyVersion), nonce, { authTagLength: 16 });
      cipher.setAAD(this.#aad(userId, keyVersion));
      plaintext = Buffer.from(secret);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Object.freeze({
        ciphertext: ciphertext.toString('base64url'),
        nonce: nonce.toString('base64url'),
        authenticationTag: cipher.getAuthTag().toString('base64url'),
        keyVersion,
      });
    } catch {
      throw new AuthSecurityError();
    } finally {
      plaintext?.fill(0);
    }
  }

  /** The caller owns the returned buffer and must clear it after use; never serialize it. */
  decrypt(userId: string, envelope: TotpEnvelope): Buffer {
    let provisionalPlaintext: Buffer | undefined;
    try {
      requireKeyVersion(envelope?.keyVersion);
      const nonce = decodeBase64Url(envelope.nonce, 12, 12);
      const tag = decodeBase64Url(envelope.authenticationTag, 16, 16);
      const ciphertext = decodeBase64Url(envelope.ciphertext, 1, TOTP_MAX_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.#key(envelope.keyVersion), nonce, { authTagLength: 16 });
      decipher.setAAD(this.#aad(userId, envelope.keyVersion));
      decipher.setAuthTag(tag);
      provisionalPlaintext = decipher.update(ciphertext);
      const finalPlaintext = decipher.final();
      return Buffer.concat([provisionalPlaintext, finalPlaintext]);
    } catch {
      throw new AuthSecurityError();
    } finally {
      // GCM update may produce unauthenticated plaintext before final verifies the tag.
      provisionalPlaintext?.fill(0);
    }
  }
}

/** Raw bearer token is intentionally omitted from ordinary object serialization/inspection. */
class SessionToken {
  readonly #token: string;
  readonly digest: string;

  constructor(token: string) {
    this.#token = token;
    this.digest = digestSessionToken(token);
    Object.freeze(this);
  }

  get token(): string { return this.#token; }
}

export function createSessionToken(): SessionToken {
  return new SessionToken(randomBytes(32).toString('base64url'));
}

/** Canonical opaque tokens only. A digest is safe to persist, but never grants assurance itself. */
export function digestSessionToken(token: string): string {
  const bytes = decodeBase64Url(token, 32, 32);
  try {
    return createHash('sha256').update('rahrow:auth:session-token:v1\0').update(bytes).digest('hex');
  } finally {
    bytes.fill(0);
  }
}
