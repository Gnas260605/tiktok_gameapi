-- CreateEnum
CREATE TYPE "PlayerGender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('active', 'banned');

-- CreateEnum
CREATE TYPE "BreakthroughStatus" AS ENUM ('preparing', 'resolving', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "BreakthroughResult" AS ENUM ('success', 'failure');

-- CreateEnum
CREATE TYPE "BreakthroughTrigger" AS ENUM ('chat', 'api');

-- CreateEnum
CREATE TYPE "GiftTxStatus" AS ENUM ('applied', 'pending', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "GiftTxType" AS ENUM ('cultivation', 'breakthrough_bonus', 'cultivation_and_bonus', 'unjoined_pending', 'unpriced', 'ignored_game_disabled', 'overflow_capped', 'admin_adjustment');

-- CreateEnum
CREATE TYPE "GameEventType" AS ENUM ('player_joined', 'player_returned', 'exp_gained', 'level_up', 'max_level_reached', 'breakthrough_started', 'breakthrough_bonus', 'breakthrough_succeeded', 'breakthrough_failed', 'breakthrough_cancelled', 'player_adjusted', 'player_reset', 'config_changed', 'command_rejected');

-- CreateEnum
CREATE TYPE "AdminAction" AS ENUM ('player.adjust', 'player.reset', 'config.update', 'realm.update', 'gift_tx.retry');

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['*']::TEXT[];

-- CreateTable
CREATE TABLE "game_players" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tiktok_user_id" VARCHAR(120),
    "username" VARCHAR(255) NOT NULL,
    "nickname" VARCHAR(255),
    "avatar_url" TEXT,
    "gender" "PlayerGender" NOT NULL DEFAULT 'male',
    "realm_order" SMALLINT NOT NULL DEFAULT 1,
    "level" SMALLINT NOT NULL DEFAULT 1,
    "current_exp" BIGINT NOT NULL DEFAULT 0,
    "total_cultivation" BIGINT NOT NULL DEFAULT 0,
    "total_diamonds_gifted" BIGINT NOT NULL DEFAULT 0,
    "breakthrough_success_count" INTEGER NOT NULL DEFAULT 0,
    "breakthrough_fail_count" INTEGER NOT NULL DEFAULT 0,
    "breakthrough_cooldown_until" TIMESTAMPTZ(6),
    "realm_reached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cultivation_reached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gifts_reached_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gender_changed_at" TIMESTAMPTZ(6),
    "status" "PlayerStatus" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 0,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cultivation_realms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "realm_order" SMALLINT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "base_chance_bp" INTEGER,
    "chance_bp_per_100_diamonds" INTEGER,
    "theme_color" CHAR(7),
    "character_male_asset" VARCHAR(120) NOT NULL,
    "character_female_asset" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cultivation_realms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cultivation_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "realm_order" SMALLINT NOT NULL,
    "level" SMALLINT NOT NULL,
    "required_exp" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cultivation_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(160) NOT NULL,
    "event_id" UUID,
    "live_session_id" UUID NOT NULL,
    "player_id" UUID,
    "user_id" UUID NOT NULL,
    "breakthrough_session_id" UUID,
    "gift_id" VARCHAR(120) NOT NULL,
    "gift_name" VARCHAR(255) NOT NULL,
    "diamond_value" INTEGER,
    "gift_quantity" INTEGER NOT NULL DEFAULT 1,
    "total_diamonds" BIGINT NOT NULL DEFAULT 0,
    "cultivation_received" BIGINT NOT NULL DEFAULT 0,
    "chance_bonus_bp" INTEGER NOT NULL DEFAULT 0,
    "transaction_type" "GiftTxType" NOT NULL,
    "status" "GiftTxStatus" NOT NULL DEFAULT 'pending',
    "realm_before" SMALLINT,
    "level_before" SMALLINT,
    "exp_before" BIGINT,
    "realm_after" SMALLINT,
    "level_after" SMALLINT,
    "exp_after" BIGINT,
    "error_message" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breakthrough_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "live_session_id" UUID NOT NULL,
    "source_realm_order" SMALLINT NOT NULL,
    "target_realm_order" SMALLINT NOT NULL,
    "base_chance_bp" INTEGER NOT NULL,
    "max_chance_bp" INTEGER NOT NULL DEFAULT 9500,
    "bonus_diamonds" BIGINT NOT NULL DEFAULT 0,
    "gift_bonus_bp" INTEGER NOT NULL DEFAULT 0,
    "final_chance_bp" INTEGER,
    "status" "BreakthroughStatus" NOT NULL DEFAULT 'preparing',
    "config_snapshot" JSONB NOT NULL DEFAULT '{}',
    "trigger" "BreakthroughTrigger" NOT NULL DEFAULT 'chat',
    "request_key" VARCHAR(160),
    "request_hash" CHAR(64),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "breakthrough_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breakthrough_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "result" "BreakthroughResult" NOT NULL,
    "roll" INTEGER NOT NULL,
    "final_chance_bp" INTEGER NOT NULL,
    "cultivation_penalty" BIGINT NOT NULL DEFAULT 0,
    "realm_before" SMALLINT NOT NULL,
    "exp_before" BIGINT NOT NULL,
    "realm_after" SMALLINT NOT NULL,
    "exp_after" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breakthrough_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_configurations" (
    "tenant_id" UUID NOT NULL,
    "config_key" VARCHAR(80) NOT NULL,
    "config_value" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by_api_key_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "game_configurations_pkey" PRIMARY KEY ("tenant_id","config_key")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "live_session_id" UUID,
    "player_id" UUID,
    "event_type" "GameEventType" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_api_key_id" UUID,
    "action" "AdminAction" NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(120) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "request_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "game_players_tenant_id_realm_order_level_current_exp_realm__idx" ON "game_players"("tenant_id", "realm_order" DESC, "level" DESC, "current_exp" DESC, "realm_reached_at" ASC);

-- CreateIndex
CREATE INDEX "game_players_tenant_id_total_cultivation_cultivation_reache_idx" ON "game_players"("tenant_id", "total_cultivation" DESC, "cultivation_reached_at" ASC);

-- CreateIndex
CREATE INDEX "game_players_tenant_id_breakthrough_success_count_idx" ON "game_players"("tenant_id", "breakthrough_success_count" DESC);

-- CreateIndex
CREATE INDEX "game_players_tenant_id_total_diamonds_gifted_gifts_reached__idx" ON "game_players"("tenant_id", "total_diamonds_gifted" DESC, "gifts_reached_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "game_players_tenant_id_id_key" ON "game_players"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_tenant_id_user_id_key" ON "game_players"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cultivation_realms_tenant_id_id_key" ON "cultivation_realms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cultivation_realms_tenant_id_realm_order_key" ON "cultivation_realms"("tenant_id", "realm_order");

-- CreateIndex
CREATE UNIQUE INDEX "cultivation_realms_tenant_id_code_key" ON "cultivation_realms"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cultivation_levels_tenant_id_id_key" ON "cultivation_levels"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cultivation_levels_tenant_id_realm_order_level_key" ON "cultivation_levels"("tenant_id", "realm_order", "level");

-- CreateIndex
CREATE INDEX "gift_transactions_tenant_id_player_id_created_at_idx" ON "gift_transactions"("tenant_id", "player_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "gift_transactions_tenant_id_status_idx" ON "gift_transactions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "gift_transactions_tenant_id_user_id_idx" ON "gift_transactions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "gift_transactions_tenant_id_live_session_id_total_diamonds_idx" ON "gift_transactions"("tenant_id", "live_session_id", "total_diamonds" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "gift_transactions_tenant_id_id_key" ON "gift_transactions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_transactions_tenant_id_idempotency_key_key" ON "gift_transactions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "breakthrough_sessions_tenant_id_player_id_created_at_idx" ON "breakthrough_sessions"("tenant_id", "player_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "breakthrough_sessions_tenant_id_status_idx" ON "breakthrough_sessions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "breakthrough_sessions_ends_at_idx" ON "breakthrough_sessions"("ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "breakthrough_sessions_tenant_id_id_key" ON "breakthrough_sessions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "breakthrough_sessions_tenant_id_request_key_key" ON "breakthrough_sessions"("tenant_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "breakthrough_history_session_id_key" ON "breakthrough_history"("session_id");

-- CreateIndex
CREATE INDEX "breakthrough_history_tenant_id_player_id_created_at_idx" ON "breakthrough_history"("tenant_id", "player_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "breakthrough_history_tenant_id_id_key" ON "breakthrough_history"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "breakthrough_history_tenant_id_session_id_key" ON "breakthrough_history"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "game_events_tenant_id_seq_idx" ON "game_events"("tenant_id", "seq");

-- CreateIndex
CREATE INDEX "game_events_tenant_id_player_id_created_at_idx" ON "game_events"("tenant_id", "player_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "game_events_tenant_id_id_key" ON "game_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "game_events_seq_key" ON "game_events"("seq");

-- CreateIndex
CREATE INDEX "admin_audit_logs_tenant_id_created_at_idx" ON "admin_audit_logs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_logs_tenant_id_target_type_target_id_idx" ON "admin_audit_logs"("tenant_id", "target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_audit_logs_tenant_id_id_key" ON "admin_audit_logs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenant_id_id_key" ON "events"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_tenant_id_realm_order_fkey" FOREIGN KEY ("tenant_id", "realm_order") REFERENCES "cultivation_realms"("tenant_id", "realm_order") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cultivation_realms" ADD CONSTRAINT "cultivation_realms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cultivation_levels" ADD CONSTRAINT "cultivation_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cultivation_levels" ADD CONSTRAINT "cultivation_levels_tenant_id_realm_order_fkey" FOREIGN KEY ("tenant_id", "realm_order") REFERENCES "cultivation_realms"("tenant_id", "realm_order") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_event_id_fkey" FOREIGN KEY ("tenant_id", "event_id") REFERENCES "events"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_live_session_id_fkey" FOREIGN KEY ("tenant_id", "live_session_id") REFERENCES "live_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_player_id_fkey" FOREIGN KEY ("tenant_id", "player_id") REFERENCES "game_players"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_transactions" ADD CONSTRAINT "gift_transactions_tenant_id_breakthrough_session_id_fkey" FOREIGN KEY ("tenant_id", "breakthrough_session_id") REFERENCES "breakthrough_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_sessions" ADD CONSTRAINT "breakthrough_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_sessions" ADD CONSTRAINT "breakthrough_sessions_tenant_id_player_id_fkey" FOREIGN KEY ("tenant_id", "player_id") REFERENCES "game_players"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_sessions" ADD CONSTRAINT "breakthrough_sessions_tenant_id_live_session_id_fkey" FOREIGN KEY ("tenant_id", "live_session_id") REFERENCES "live_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_history" ADD CONSTRAINT "breakthrough_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_history" ADD CONSTRAINT "breakthrough_history_tenant_id_player_id_fkey" FOREIGN KEY ("tenant_id", "player_id") REFERENCES "game_players"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "breakthrough_history" ADD CONSTRAINT "breakthrough_history_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "breakthrough_sessions"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_configurations" ADD CONSTRAINT "game_configurations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_configurations" ADD CONSTRAINT "game_configurations_updated_by_api_key_id_fkey" FOREIGN KEY ("updated_by_api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_tenant_id_live_session_id_fkey" FOREIGN KEY ("tenant_id", "live_session_id") REFERENCES "live_sessions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_tenant_id_player_id_fkey" FOREIGN KEY ("tenant_id", "player_id") REFERENCES "game_players"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actor_api_key_id_fkey" FOREIGN KEY ("actor_api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Custom SQL additions (Partial Unique Index and CHECK Constraints)

-- 1. Partial Unique Index for Breakthrough: only one active session ('preparing', 'resolving') per player per tenant
CREATE UNIQUE INDEX breakthrough_one_active_per_player
  ON "breakthrough_sessions" ("tenant_id", "player_id")
  WHERE "status" IN ('preparing', 'resolving');

-- 2. Breakthrough Due recovery index
CREATE INDEX breakthrough_due
  ON "breakthrough_sessions" ("ends_at")
  WHERE "status" = 'preparing';

-- 3. CHECK constraints on realm_order (1 to 8)
ALTER TABLE "cultivation_realms" ADD CONSTRAINT "cultivation_realms_realm_order_check"
  CHECK ("realm_order" BETWEEN 1 AND 8);

ALTER TABLE "cultivation_levels" ADD CONSTRAINT "cultivation_levels_realm_order_check"
  CHECK ("realm_order" BETWEEN 1 AND 8);

ALTER TABLE "game_players" ADD CONSTRAINT "game_players_realm_order_check"
  CHECK ("realm_order" BETWEEN 1 AND 8);

-- 4. CHECK constraints on level (1 to 10)
ALTER TABLE "cultivation_levels" ADD CONSTRAINT "cultivation_levels_level_check"
  CHECK ("level" BETWEEN 1 AND 10);

ALTER TABLE "game_players" ADD CONSTRAINT "game_players_level_check"
  CHECK ("level" BETWEEN 1 AND 10);

-- 5. CHECK constraints on required_exp (> 0) and current_exp (>= 0)
ALTER TABLE "cultivation_levels" ADD CONSTRAINT "cultivation_levels_required_exp_check"
  CHECK ("required_exp" > 0);

ALTER TABLE "game_players" ADD CONSTRAINT "game_players_current_exp_check"
  CHECK ("current_exp" >= 0);

-- 6. CHECK constraints on base_chance_bp (0 to 10000)
ALTER TABLE "cultivation_realms" ADD CONSTRAINT "cultivation_realms_base_chance_bp_check"
  CHECK ("base_chance_bp" IS NULL OR ("base_chance_bp" BETWEEN 0 AND 10000));

ALTER TABLE "breakthrough_sessions" ADD CONSTRAINT "breakthrough_sessions_base_chance_bp_check"
  CHECK ("base_chance_bp" BETWEEN 0 AND 10000);

-- 7. CHECK target_realm_order = source_realm_order + 1
ALTER TABLE "breakthrough_sessions" ADD CONSTRAINT "breakthrough_sessions_target_realm_order_check"
  CHECK ("target_realm_order" = "source_realm_order" + 1);
