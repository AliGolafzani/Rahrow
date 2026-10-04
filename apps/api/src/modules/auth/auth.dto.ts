import { Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AuthenticatedSelf, AuthenticatedSession, RequestOtpInput, VerifyOtpInput } from '@rahrow/contracts';
import { AuthHttpError } from './auth.errors.js';

export const MOBILE_PATTERN = '^\\+[1-9][0-9]{0,14}$';
export const CHALLENGE_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
export const OTP_PATTERN = '^[0-9]{6}$';

export class RequestOtpDto implements RequestOtpInput {
  @ApiProperty({ type: String, minLength: 2, maxLength: 16, pattern: MOBILE_PATTERN })
  declare mobile: string;
}
export class VerifyOtpDto extends RequestOtpDto implements VerifyOtpInput {
  @ApiProperty({ type: String, format: 'uuid', minLength: 36, maxLength: 36, pattern: CHALLENGE_PATTERN })
  declare challengeId: string;
  @ApiProperty({ type: String, minLength: 6, maxLength: 6, pattern: OTP_PATTERN })
  declare code: string;
}
export class EmptyAuthDto {}

/** Validation stays explicit, bounded and non-coercing; metadata also drives OpenAPI. */
@Injectable()
export class AuthDtoPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') return value;
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) throw new AuthHttpError('AUTH_INVALID_INPUT');
    const dto = value as Record<string, unknown>;
    const fields = metadata.metatype === VerifyOtpDto ? ['mobile', 'challengeId', 'code'] :
      metadata.metatype === RequestOtpDto ? ['mobile'] : metadata.metatype === EmptyAuthDto ? [] : null;
    if (fields === null || Object.keys(dto).length !== fields.length ||
        Object.keys(dto).some(key => !fields.includes(key))) throw new AuthHttpError('AUTH_INVALID_INPUT');
    const matches = (field: string, pattern: string, max: number) => typeof dto[field] === 'string' &&
      dto[field].length <= max && new RegExp(pattern, 'u').test(dto[field]);
    if (fields.includes('mobile') && !matches('mobile', MOBILE_PATTERN, 16) ||
        fields.includes('challengeId') && !matches('challengeId', CHALLENGE_PATTERN, 36) ||
        fields.includes('code') && !matches('code', OTP_PATTERN, 6)) throw new AuthHttpError('AUTH_INVALID_INPUT');
    return value;
  }
}

export class RequestedOtpDto {
  @ApiProperty({ type: String, format: 'uuid' }) declare challengeId: string;
  @ApiProperty({ type: String, format: 'date-time' }) declare expiresAt: string;
  @ApiProperty({ type: Number, minimum: 0, maximum: 86400 }) declare retryAfterSeconds: number;
}
export class AuthenticatedSelfDto implements AuthenticatedSelf {
  @ApiProperty({ type: String, format: 'uuid' }) declare id: string;
  @ApiProperty({ type: String, pattern: MOBILE_PATTERN }) declare mobile: string;
  @ApiProperty({ type: String, nullable: true }) declare email: string | null;
  @ApiProperty({ type: String, nullable: true }) declare firstName: string | null;
  @ApiProperty({ type: String, nullable: true }) declare lastName: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) declare birthDate: string | null;
  @ApiProperty({ type: String, nullable: true }) declare displayName: string | null;
  @ApiProperty({ type: String, nullable: true }) declare avatar: string | null;
}
export class SessionExpiryDto {
  @ApiProperty({ type: String, format: 'date-time' }) declare expiresAt: string;
}
export class AuthenticatedSessionDto implements AuthenticatedSession {
  @ApiProperty({ type: AuthenticatedSelfDto }) declare user: AuthenticatedSelfDto;
  @ApiProperty({ type: SessionExpiryDto }) declare session: SessionExpiryDto;
}
export class RotatedSessionDto {
  @ApiProperty({ type: SessionExpiryDto }) declare session: SessionExpiryDto;
}
class AuthErrorDetailDto {
  @ApiProperty({ type: String, enum: ['AUTH_INVALID_INPUT', 'AUTH_REQUEST_FORBIDDEN', 'AUTH_THROTTLED',
    'AUTH_OTP_INVALID', 'AUTH_OTP_EXPIRED', 'AUTH_OTP_EXHAUSTED', 'AUTH_OTP_CONSUMED',
    'AUTH_SESSION_INVALID', 'AUTH_SESSION_EXPIRED', 'AUTH_DELIVERY_UNAVAILABLE', 'AUTH_UNAVAILABLE'] }) declare code: string;
  @ApiProperty({ type: String }) declare message: string;
  @ApiProperty({ type: String, format: 'uuid' }) declare correlationId: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 86400 }) declare retryAfterSeconds?: number;
}
export class AuthErrorDto {
  @ApiProperty({ type: AuthErrorDetailDto }) declare error: AuthErrorDetailDto;
}

/** Defense-in-depth allowlist: no internal fields, principal or bearer can be spread into JSON. */
export function authenticatedSessionDto(result: { user: AuthenticatedSelf; expiresAt: Date }): AuthenticatedSession {
  const { user } = result;
  return { user: {
    id: user.id, mobile: user.mobile, email: user.email, firstName: user.firstName,
    lastName: user.lastName, birthDate: user.birthDate, displayName: user.displayName, avatar: user.avatar,
  }, session: { expiresAt: result.expiresAt.toISOString() } };
}
