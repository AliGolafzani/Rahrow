import { OtpDeliveryProvider, type OtpDelivery } from './otp-delivery.provider.js';

/** Harness-only view: secrets are private and absent from JSON/normal inspection. */
export class RecordedOtpDelivery {
  readonly challengeId: string;
  readonly expiresAt: Date;
  readonly #target: string;
  readonly #code: string;
  constructor(input: OtpDelivery) {
    this.challengeId = input.challengeId;
    this.expiresAt = new Date(input.expiresAt);
    this.#target = input.target;
    this.#code = input.code;
    Object.freeze(this);
  }
  get target(): string { return this.#target; }
  get code(): string { return this.#code; }
}

/** Bounded in-process recorder. There is no HTTP, file or normal-log reveal mechanism. */
export class FakeOtpDeliveryProvider extends OtpDeliveryProvider {
  readonly #deliveries = new Map<string, RecordedOtpDelivery>();
  readonly #capacity: number;
  readonly #clock: () => Date;
  constructor(capacity = 1_000, clock: () => Date = () => new Date()) {
    super();
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000) throw new Error('Invalid local delivery capacity.');
    this.#capacity = capacity;
    this.#clock = clock;
  }
  async deliver(input: OtpDelivery): Promise<void> {
    const now = this.#clock();
    for (const [id, record] of this.#deliveries) if (record.expiresAt <= now) this.#deliveries.delete(id);
    if (input.signal.aborted || input.expiresAt <= now || this.#deliveries.size >= this.#capacity || this.#deliveries.has(input.challengeId)) {
      throw new Error('Local OTP delivery unavailable.');
    }
    this.#deliveries.set(input.challengeId, new RecordedOtpDelivery(input));
  }
  getDelivery(challengeId: string): RecordedOtpDelivery | undefined {
    const record = this.#deliveries.get(challengeId);
    if (record && record.expiresAt <= this.#clock()) { this.#deliveries.delete(challengeId); return undefined; }
    return record;
  }
  get size(): number { return this.#deliveries.size; }
}
