import { PrismaClient, TenantStatus, ApiKeyStatus } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

interface SeedTenantConfig {
  id: string;
  name: string;
  status: TenantStatus;
  apiKey: {
    name: string;
    plaintextKey: string;
    keyPrefix: string;
  };
  settings: {
    eventRetentionDays: number;
    maxActiveSessions: number;
    settings?: Record<string, any>;
  };
}

const SEED_TENANTS: SeedTenantConfig[] = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Acme Corp',
    status: TenantStatus.active,
    apiKey: {
      name: 'Acme Production Key',
      plaintextKey: 'tik_live_acme_secret_key_1234567890abcdef',
      keyPrefix: 'tik_live_acme',
    },
    settings: {
      eventRetentionDays: 30,
      maxActiveSessions: 5,
      settings: {
        allowed_regions: ['US', 'EU'],
      },
    },
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    name: 'Beta Streamers',
    status: TenantStatus.active,
    apiKey: {
      name: 'Beta Dev Key',
      plaintextKey: 'tik_live_beta_secret_key_abcdef1234567890',
      keyPrefix: 'tik_live_beta',
    },
    settings: {
      eventRetentionDays: 14,
      maxActiveSessions: 2,
      settings: {
        allowed_regions: ['GLOBAL'],
      },
    },
  },
];

export async function seed(): Promise<void> {
  console.log('--- Starting Database Seeding ---');

  for (const tenantConfig of SEED_TENANTS) {
    // 1. Upsert Tenant
    const tenant = await prisma.tenant.upsert({
      where: { id: tenantConfig.id },
      update: {
        name: tenantConfig.name,
        status: tenantConfig.status,
      },
      create: {
        id: tenantConfig.id,
        name: tenantConfig.name,
        status: tenantConfig.status,
      },
    });
    console.log(`Tenant upserted: ${tenant.name} (${tenant.id})`);

    // 2. Compute SHA-256 hash for API Key
    const keyHash = crypto
      .createHash('sha256')
      .update(tenantConfig.apiKey.plaintextKey)
      .digest('hex');

    // 3. Upsert API Key
    await prisma.apiKey.upsert({
      where: { keyPrefix: tenantConfig.apiKey.keyPrefix },
      update: {
        tenantId: tenant.id,
        name: tenantConfig.apiKey.name,
        keyHash,
        status: ApiKeyStatus.active,
        revoked: false,
      },
      create: {
        tenantId: tenant.id,
        name: tenantConfig.apiKey.name,
        keyPrefix: tenantConfig.apiKey.keyPrefix,
        keyHash,
        status: ApiKeyStatus.active,
        revoked: false,
      },
    });
    console.log(`  API Key configured: [${tenantConfig.apiKey.keyPrefix}] -> Hash: ${keyHash.substring(0, 12)}...`);
    console.log(`  Plaintext Secret (for testing/development): ${tenantConfig.apiKey.plaintextKey}`);

    // 4. Upsert Tenant Settings
    await prisma.tenantSettings.upsert({
      where: { tenantId: tenant.id },
      update: {
        eventRetentionDays: tenantConfig.settings.eventRetentionDays,
        maxActiveSessions: tenantConfig.settings.maxActiveSessions,
        settings: tenantConfig.settings.settings ?? {},
      },
      create: {
        tenantId: tenant.id,
        eventRetentionDays: tenantConfig.settings.eventRetentionDays,
        maxActiveSessions: tenantConfig.settings.maxActiveSessions,
        settings: tenantConfig.settings.settings ?? {},
      },
    });
    console.log(`  Settings saved: retention=${tenantConfig.settings.eventRetentionDays}d, maxSessions=${tenantConfig.settings.maxActiveSessions}`);
  }

  console.log('--- Database Seeding Completed Successfully ---');
}

seed()
  .catch((error) => {
    console.error('Database seeding failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
