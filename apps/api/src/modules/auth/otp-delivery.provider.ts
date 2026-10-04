export interface OtpDelivery {
  readonly challengeId: string;
  readonly target: string;
  readonly code: string;
  readonly expiresAt: Date;
  readonly signal: AbortSignal;
}

/** Delivery is not an authentication authority. No retries or real provider in AUTH-02. */
export abstract class OtpDeliveryProvider {
  abstract deliver(delivery: OtpDelivery): Promise<void>;
}
