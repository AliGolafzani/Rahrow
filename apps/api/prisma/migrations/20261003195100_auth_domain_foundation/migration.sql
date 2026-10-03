-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuthenticationMethod" AS ENUM ('MOBILE_OTP', 'ADMIN_PASSWORD_TOTP');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "mobile" VARCHAR(16) NOT NULL,
    "email" VARCHAR(254),
    "firstName" VARCHAR(100),
    "lastName" VARCHAR(100),
    "birthDate" DATE,
    "displayName" VARCHAR(200),
    "avatar" VARCHAR(2048),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "userId" UUID NOT NULL,
    "passwordHash" VARCHAR(512) NOT NULL,
    "totpCiphertext" BYTEA NOT NULL,
    "totpNonce" BYTEA NOT NULL,
    "totpAuthenticationTag" BYTEA NOT NULL,
    "totpKeyVersion" VARCHAR(64) NOT NULL,
    "lastAcceptedTotpStep" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenDigest" CHAR(64) NOT NULL,
    "authenticationMethod" "AuthenticationMethod" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "rotatedFromId" UUID,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "targetDigest" CHAR(64) NOT NULL,
    "codeMac" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "attemptLimit" INTEGER NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimitBucket" (
    "bucketKey" CHAR(64) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("bucketKey","scope","windowStart")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entityType" VARCHAR(32) NOT NULL,
    "entityId" VARCHAR(128) NOT NULL,
    "beforeSummary" JSONB,
    "afterSummary" JSONB,
    "correlationId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenDigest_key" ON "AuthSession"("tokenDigest");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_rotatedFromId_key" ON "AuthSession"("rotatedFromId");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_targetDigest_expiresAt_idx" ON "OtpChallenge"("targetDigest", "expiresAt");

-- CreateIndex
CREATE INDEX "AuthRateLimitBucket_expiresAt_idx" ON "AuthRateLimitBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_occurredAt_idx" ON "AuditLog"("entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_occurredAt_idx" ON "AuditLog"("actorId", "occurredAt");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Technical invariants, not product eligibility/status policy.
ALTER TABLE "User" ADD CONSTRAINT "User_mobile_e164" CHECK ("mobile" ~ '^\+[1-9][0-9]{0,14}$');
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_key_capability" CHECK ("key" ~ '^[a-z][a-z0-9]*([.:-][a-z][a-z0-9]*)+$');
ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_envelope" CHECK (
  octet_length("totpNonce") = 12 AND octet_length("totpAuthenticationTag") = 16
  AND octet_length("totpCiphertext") BETWEEN 1 AND 1024
  AND length("totpKeyVersion") BETWEEN 1 AND 64
  AND ("lastAcceptedTotpStep" IS NULL OR "lastAcceptedTotpStep" >= 0)
);
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_state" CHECK (
  "tokenDigest" ~ '^[a-f0-9]{64}$' AND "expiresAt" > "createdAt"
  AND ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
  AND ("rotatedFromId" IS NULL OR "rotatedFromId" <> "id")
);
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_state" CHECK (
  "targetDigest" ~ '^[a-f0-9]{64}$' AND "codeMac" ~ '^[a-f0-9]{64}$'
  AND "expiresAt" > "createdAt" AND "attemptLimit" BETWEEN 1 AND 20
  AND "failedAttempts" BETWEEN 0 AND "attemptLimit"
  AND ("consumedAt" IS NULL OR ("consumedAt" >= "createdAt" AND "consumedAt" < "expiresAt"))
);
ALTER TABLE "AuthRateLimitBucket" ADD CONSTRAINT "AuthRateLimitBucket_state" CHECK (
  "bucketKey" ~ '^[a-f0-9]{64}$' AND "scope" IN ('otp-challenge', 'otp-verification', 'session')
  AND "count" BETWEEN 1 AND 10000 AND "expiresAt" > "windowStart"
);
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_summary_bounds" CHECK (
  ("beforeSummary" IS NULL OR (jsonb_typeof("beforeSummary") = 'object' AND octet_length("beforeSummary"::text) <= 1024))
  AND ("afterSummary" IS NULL OR (jsonb_typeof("afterSummary") = 'object' AND octet_length("afterSummary"::text) <= 1024))
);
