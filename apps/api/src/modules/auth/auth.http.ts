import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingHttpHeaders } from 'node:http';
import { AuthConfig } from './auth.config.js';
import { readSessionCookie } from './auth.cookies.js';
import { AuthHttpError, authCorrelationId, sendAuthError, setAuthNoStore } from './auth.errors.js';
import type { AuthErrorResponse } from './auth.errors.js';

export interface AuthHttpRequest {
  method: string;
  url: string;
  path?: string;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
  authCorrelationId?: string;
}
export interface AuthHttpResponse extends AuthErrorResponse { end(): unknown }

export function assertAuthHttpRequest(request: AuthHttpRequest, configuration: AuthConfig): void {
  configuration.assertAvailable();
  if (request.headers?.['x-rahrow-auth'] !== '1') throw new AuthHttpError('AUTH_REQUEST_FORBIDDEN');
  const origin = request.headers.origin;
  if (origin !== undefined && (typeof origin !== 'string' || !configuration.allowedOrigins.includes(origin))) {
    throw new AuthHttpError('AUTH_REQUEST_FORBIDDEN');
  }
  if (request.method === 'POST') {
    if (origin === undefined || typeof request.headers['content-type'] !== 'string' ||
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers['content-type'])) {
      throw new AuthHttpError('AUTH_REQUEST_FORBIDDEN');
    }
  } else if (request.method === 'GET') {
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && !['same-origin', 'same-site', 'none'].includes(String(site))) {
      throw new AuthHttpError('AUTH_REQUEST_FORBIDDEN');
    }
  } else throw new AuthHttpError('AUTH_REQUEST_FORBIDDEN');
  // Reject ambiguity for every operation, including pre-auth requests.
  readSessionCookie(request, configuration);
}

/** Never use request.ip or forwarded headers: no proxy trust is configured in AUTH-02. */
export function authClientIp(request: AuthHttpRequest): string {
  const address = request.socket.remoteAddress;
  if (typeof address !== 'string' || address.length === 0 || address.length > 128) throw new AuthHttpError('AUTH_UNAVAILABLE');
  return address;
}

@Injectable()
export class AuthHttpGuard implements CanActivate {
  constructor(private readonly configuration: AuthConfig) {}
  canActivate(context: ExecutionContext): boolean {
    assertAuthHttpRequest(context.switchToHttp().getRequest<AuthHttpRequest>(), this.configuration);
    return true;
  }
}

export function isAuthPath(request: Pick<AuthHttpRequest, 'url' | 'path'>): boolean {
  // Express' parsed path matches its router, including absolute-form HTTP targets.
  const path = (request.path ?? request.url).split('?')[0];
  // Express routing is case-insensitive. Cover encoded prefixes too so parser errors
  // cannot escape the bounded filter even when an encoded route ultimately returns 404.
  const decoded = path.replace(/%[0-9a-f]{2}/giu, value => String.fromCharCode(Number.parseInt(value.slice(1), 16)));
  return /^\/api\/v1\/auth(?:\/|$)/iu.test(path) || /^\/api\/v1\/auth(?:\/|$)/iu.test(decoded);
}

/** Register before Nest init; parser errors get the same bounded auth envelope. No docs route. */
export function configureAuthHttp(app: NestExpressApplication, configuration: AuthConfig): void {
  const express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', false);
  express.disable('x-powered-by');
  app.use((request: AuthHttpRequest, response: AuthHttpResponse, next: (error?: unknown) => void) => {
    if (!isAuthPath(request)) return next();
    setAuthNoStore(response);
    response.setHeader('X-Correlation-Id', authCorrelationId(request));
    response.setHeader('Vary', 'Origin');
    const origin = request.headers.origin;
    if (typeof origin === 'string' && configuration.allowedOrigins.includes(origin)) {
      // Assign the matched configured value, never an arbitrary reflected origin.
      response.setHeader('Access-Control-Allow-Origin', configuration.allowedOrigins.find(value => value === origin)!);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Expose-Headers', 'X-Correlation-Id, Retry-After');
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      const requestedHeaders = typeof headers === 'string' ? headers.toLowerCase().split(',').map(value => value.trim()) : [];
      if (typeof origin !== 'string' || !configuration.allowedOrigins.includes(origin) ||
          !['GET', 'POST'].includes(String(method)) || requestedHeaders.some(value => !['content-type', 'x-rahrow-auth'].includes(value))) {
        return sendAuthError(new AuthHttpError('AUTH_REQUEST_FORBIDDEN'), request, response);
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Rahrow-Auth');
      response.status(204);
      return response.end();
    }
    try { assertAuthHttpRequest(request, configuration); next(); }
    catch (error) { sendAuthError(error, request, response); }
  });
  app.useBodyParser('json', { limit: 4096, strict: true, type: 'application/json', inflate: false });
  app.use((error: unknown, request: AuthHttpRequest, response: AuthHttpResponse, next: (error?: unknown) => void) => {
    if (!isAuthPath(request)) return next(error);
    // Body-parser diagnostics can contain raw input; no field is returned or logged.
    sendAuthError(new AuthHttpError('AUTH_INVALID_INPUT'), request, response);
  });
}
