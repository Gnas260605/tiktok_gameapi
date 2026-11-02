-- Drop composite FK constraint that attempts to nullify tenant_id on delete
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_tenant_id_user_id_fkey";

-- Re-create composite FK constraint with PostgreSQL 15+ column-specific ON DELETE SET NULL ("user_id")
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_user_id_fkey"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id")
  ON DELETE SET NULL ("user_id") ON UPDATE CASCADE;
