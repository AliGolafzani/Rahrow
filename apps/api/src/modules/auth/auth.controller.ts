import { Body, Controller, Get, HttpCode, Post, Req, Res, UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthConfig } from './auth.config.js';
import { clearSessionCookie, sessionCookie } from './auth.cookies.js';
import { AuthDtoPipe, AuthenticatedSessionDto, AuthErrorDto, EmptyAuthDto, RequestOtpDto, RequestedOtpDto, RotatedSessionDto, VerifyOtpDto, authenticatedSessionDto } from './auth.dto.js';
import { AuthExceptionFilter, authCorrelationId } from './auth.errors.js';
import { TrustedSessionResolver } from './auth.guard.js';
import { AuthHttpGuard, authClientIp } from './auth.http.js';
import type { AuthHttpRequest, AuthHttpResponse } from './auth.http.js';
import { MobileOtpService } from './mobile-otp.service.js';

@ApiTags('Authentication')
@ApiHeader({ name: 'X-Rahrow-Auth', required: true, schema: { type: 'string', enum: ['1'] } })
@ApiResponse({ status: 400, type: AuthErrorDto, description: 'Invalid or oversized request.' })
@ApiResponse({ status: 403, type: AuthErrorDto, description: 'Origin, JSON or custom-header safeguard rejected.' })
@ApiResponse({ status: 429, type: AuthErrorDto, description: 'Authentication rate limit; Retry-After is supplied.' })
@ApiResponse({ status: 503, type: AuthErrorDto, description: 'Authentication or delivery unavailable.' })
@UseFilters(AuthExceptionFilter)
@UseGuards(AuthHttpGuard)
@UsePipes(AuthDtoPipe)
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly service: MobileOtpService, private readonly configuration: AuthConfig,
    private readonly resolver: TrustedSessionResolver) {}

  @Post('otp/request')
  @HttpCode(202)
  @ApiHeader({ name: 'Origin', required: true, schema: { type: 'string' }, description: 'Exact configured browser origin.' })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 202, type: RequestedOtpDto })
  async requestOtp(@Body() body: RequestOtpDto, @Req() request: AuthHttpRequest): Promise<RequestedOtpDto> {
    const result = await this.service.requestOtp(body, authClientIp(request), authCorrelationId(request));
    return { challengeId: result.challengeId, expiresAt: result.expiresAt.toISOString(), retryAfterSeconds: result.retryAfterSeconds };
  }

  @Post('otp/verify')
  @HttpCode(200)
  @ApiHeader({ name: 'Origin', required: true, schema: { type: 'string' }, description: 'Exact configured browser origin.' })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({ status: 200, type: AuthenticatedSessionDto, description: 'Committed authentication; bearer only in HttpOnly Set-Cookie.' })
  @ApiResponse({ status: 401, type: AuthErrorDto })
  async verifyOtp(@Body() body: VerifyOtpDto, @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse): Promise<AuthenticatedSessionDto> {
    const result = await this.service.verifyOtp(body, authClientIp(request), authCorrelationId(request));
    const dto = authenticatedSessionDto(result);
    response.setHeader('Set-Cookie', sessionCookie(this.configuration, result.token, result.expiresAt, this.configuration.now()));
    return dto;
  }

  @Get('session')
  @ApiCookieAuth('rahrowSession')
  @ApiResponse({ status: 200, type: AuthenticatedSessionDto, description: 'Private account projection; this operation never renews the session.' })
  @ApiResponse({ status: 401, type: AuthErrorDto })
  async currentSession(@Req() request: AuthHttpRequest): Promise<AuthenticatedSessionDto> {
    const token = this.requireBearer(request);
    return authenticatedSessionDto(await this.service.currentSession(token, authClientIp(request), authCorrelationId(request)));
  }

  @Post('session/rotate')
  @HttpCode(200)
  @ApiCookieAuth('rahrowSession')
  @ApiHeader({ name: 'Origin', required: true, schema: { type: 'string' }, description: 'Exact configured browser origin.' })
  @ApiBody({ type: EmptyAuthDto })
  @ApiResponse({ status: 200, type: RotatedSessionDto, description: 'Committed rotation; absolute expiry preserved. Failure never clears a cookie.' })
  @ApiResponse({ status: 401, type: AuthErrorDto })
  async rotateSession(@Body() _body: EmptyAuthDto, @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse): Promise<RotatedSessionDto> {
    const result = await this.service.rotateSession(this.requireBearer(request), authClientIp(request), authCorrelationId(request));
    const dto = { session: { expiresAt: result.expiresAt.toISOString() } };
    response.setHeader('Set-Cookie', sessionCookie(this.configuration, result.token, result.expiresAt, this.configuration.now()));
    return dto;
  }

  @Post('logout')
  @HttpCode(204)
  @ApiHeader({ name: 'Origin', required: true, schema: { type: 'string' }, description: 'Exact configured browser origin.' })
  @ApiBody({ type: EmptyAuthDto })
  @ApiResponse({ status: 204, description: 'Current login family revoked; absent/unknown bearer is idempotent. Cookie cleared only after success.' })
  async logout(@Body() _body: EmptyAuthDto, @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) response: AuthHttpResponse): Promise<void> {
    await this.service.logout(this.resolver.bearer(request), authClientIp(request), authCorrelationId(request));
    response.setHeader('Set-Cookie', clearSessionCookie(this.configuration));
  }

  private requireBearer(request: AuthHttpRequest): string {
    const token = this.resolver.bearer(request);
    // Admission occurs in the service before malformed or missing bearers are rejected.
    return token ?? '';
  }
}
