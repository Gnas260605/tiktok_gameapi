-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('queued', 'connecting', 'connected', 'reconnecting', 'disconnected', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "IdentityQuality" AS ENUM ('platform_id', 'handle_fallback', 'event_only');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('member', 'chat', 'gift', 'like', 'follow', 'share', 'roomUser', 'connected', 'disconnected', 'error');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "key_prefix" VARCHAR(24) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" VARCHAR(30) NOT NULL DEFAULT 'tiktok',
    "creator_username" VARCHAR(255) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'queued',
    "room_id" VARCHAR(255),
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "disconnect_reason" TEXT,
    "connector_metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "platform" VARCHAR(30) NOT NULL DEFAULT 'tiktok',
    "platform_user_id" VARCHAR(120),
    "unique_id" VARCHAR(255),
    "nickname" VARCHAR(255),
    "avatar_url" TEXT,
    "verified" BOOLEAN,
    "identity_quality" "IdentityQuality" NOT NULL DEFAULT 'event_only',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile_observed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID,
    "event_type" "EventType" NOT NULL,
    "source_event_id" VARCHAR(255),
    "data" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload_fingerprint" VARCHAR(128),
    "connector_name" VARCHAR(120),
    "connector_version" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "event_retention_days" INTEGER NOT NULL DEFAULT 30,
    "max_active_sessions" INTEGER NOT NULL DEFAULT 1,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_prefix_key" ON "api_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_created_at_idx" ON "api_keys"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_status_idx" ON "api_keys"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "live_sessions_tenant_id_created_at_idx" ON "live_sessions"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "live_sessions_tenant_id_status_idx" ON "live_sessions"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "live_sessions_tenant_id_id_key" ON "live_sessions"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "users_tenant_id_created_at_idx" ON "users"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_tenant_id_last_seen_at_idx" ON "users"("tenant_id", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "users_tenant_id_platform_platform_user_id_idx" ON "users"("tenant_id", "platform", "platform_user_id");

-- CreateIndex
CREATE INDEX "users_tenant_id_platform_unique_id_idx" ON "users"("tenant_id", "platform", "unique_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_id_key" ON "users"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "events_tenant_id_created_at_idx" ON "events"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "events_tenant_id_session_id_received_at_idx" ON "events"("tenant_id", "session_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "events_tenant_id_event_type_received_at_idx" ON "events"("tenant_id", "event_type", "received_at" DESC);

-- CreateIndex
CREATE INDEX "events_user_id_received_at_idx" ON "events"("user_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "events_data_idx" ON "events" USING GIN ("data");

-- CreateIndex: Partial unique index to prevent duplicate active sessions per creator per tenant
CREATE UNIQUE INDEX "uq_active_session_creator" ON "live_sessions"("tenant_id", "platform", lower("creator_username")) WHERE "status" IN ('queued', 'connecting', 'connected', 'reconnecting');

-- CreateIndex: Partial unique index for platform_user_id per tenant
CREATE UNIQUE INDEX "uq_users_platform_id" ON "users"("tenant_id", "platform", "platform_user_id") WHERE "platform_user_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "live_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
