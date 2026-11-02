-- Drop the redundant non-unique index on (tenant_id, platform, unique_id)
DROP INDEX IF EXISTS "users_tenant_id_platform_unique_id_idx";

-- Create compound unique index on (tenant_id, platform, unique_id)
-- Note: In PostgreSQL, standard UNIQUE indexes treat NULL values as distinct.
-- Multiple Tier 3 ('event_only') users with unique_id IS NULL are permitted,
-- while Tier 2 ('handle_fallback') records with identical unique_id are strictly rejected.
CREATE UNIQUE INDEX "users_tenant_id_platform_unique_id_key" ON "users"("tenant_id", "platform", "unique_id");
