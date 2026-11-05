import { PrismaClient } from '@prisma/client';
import { DEFAULT_REALM_BASES } from '../src/services/game/cultivation-engine';

const prisma = new PrismaClient();

export const SEED_REALMS = [
  {
    realmOrder: 1,
    code: 'luyen_khi',
    name: 'Luyện Khí',
    baseChanceBp: 9000,
    chanceBpPer100Diamonds: 1000,
    themeColor: '#7FD3FF',
    characterMaleAsset: 'luyen_khi_male.webp',
    characterFemaleAsset: 'luyen_khi_female.webp',
  },
  {
    realmOrder: 2,
    code: 'truc_co',
    name: 'Trúc Cơ',
    baseChanceBp: 8000,
    chanceBpPer100Diamonds: 400,
    themeColor: '#52D689',
    characterMaleAsset: 'truc_co_male.webp',
    characterFemaleAsset: 'truc_co_female.webp',
  },
  {
    realmOrder: 3,
    code: 'kim_dan',
    name: 'Kim Đan',
    baseChanceBp: 7000,
    chanceBpPer100Diamonds: 167,
    themeColor: '#FFD152',
    characterMaleAsset: 'kim_dan_male.webp',
    characterFemaleAsset: 'kim_dan_female.webp',
  },
  {
    realmOrder: 4,
    code: 'nguyen_anh',
    name: 'Nguyên Anh',
    baseChanceBp: 6000,
    chanceBpPer100Diamonds: 67,
    themeColor: '#C47FFF',
    characterMaleAsset: 'nguyen_anh_male.webp',
    characterFemaleAsset: 'nguyen_anh_female.webp',
  },
  {
    realmOrder: 5,
    code: 'hoa_than',
    name: 'Hóa Thần',
    baseChanceBp: 5000,
    chanceBpPer100Diamonds: 25,
    themeColor: '#5297FF',
    characterMaleAsset: 'hoa_than_male.webp',
    characterFemaleAsset: 'hoa_than_female.webp',
  },
  {
    realmOrder: 6,
    code: 'luyen_hu',
    name: 'Luyện Hư',
    baseChanceBp: 4000,
    chanceBpPer100Diamonds: 10,
    themeColor: '#6E52FF',
    characterMaleAsset: 'luyen_hu_male.webp',
    characterFemaleAsset: 'luyen_hu_female.webp',
  },
  {
    realmOrder: 7,
    code: 'hop_the',
    name: 'Hợp Thể',
    baseChanceBp: 3000,
    chanceBpPer100Diamonds: 4,
    themeColor: '#FFEAA7',
    characterMaleAsset: 'hop_the_male.webp',
    characterFemaleAsset: 'hop_the_female.webp',
  },
  {
    realmOrder: 8,
    code: 'dai_thua',
    name: 'Đại Thừa',
    baseChanceBp: null,
    chanceBpPer100Diamonds: null,
    themeColor: '#FF5252',
    characterMaleAsset: 'dai_thua_male.webp',
    characterFemaleAsset: 'dai_thua_female.webp',
  },
];

export const DEFAULT_GAME_CONFIG_VALUES: Record<string, any> = {
  gameEnabled: true,
  giftProcessingEnabled: true,
  effectsEnabled: true,
  tuViMultiplier: 10,
  maxOverflowRatio: 3.0,
  maxChanceBp: 9500,
  preparationSeconds: 30,
  cooldownSeconds: 300,
  failurePenaltyRatio: 0.2,
  addExpDuringBreakthrough: false,
  maxConcurrentBreakthroughs: 3,
  autoJoinOnGift: true,
  pendingGiftTtlHours: 72,
  defaultGender: 'male',
  commandCooldownSeconds: 10,
};

export async function seedTenantTuTien(client: PrismaClient, tenantId: string): Promise<void> {
  // 1. Seed 8 Realms
  for (const realm of SEED_REALMS) {
    await client.cultivationRealm.upsert({
      where: {
        tenantId_realmOrder: {
          tenantId,
          realmOrder: realm.realmOrder,
        },
      },
      update: {
        code: realm.code,
        name: realm.name,
        baseChanceBp: realm.baseChanceBp,
        chanceBpPer100Diamonds: realm.chanceBpPer100Diamonds,
        themeColor: realm.themeColor,
        characterMaleAsset: realm.characterMaleAsset,
        characterFemaleAsset: realm.characterFemaleAsset,
      },
      create: {
        tenantId,
        realmOrder: realm.realmOrder,
        code: realm.code,
        name: realm.name,
        baseChanceBp: realm.baseChanceBp,
        chanceBpPer100Diamonds: realm.chanceBpPer100Diamonds,
        themeColor: realm.themeColor,
        characterMaleAsset: realm.characterMaleAsset,
        characterFemaleAsset: realm.characterFemaleAsset,
      },
    });

    // 2. Seed 10 Levels for each Realm
    const realmBase = DEFAULT_REALM_BASES[realm.realmOrder - 1];
    for (let level = 1; level <= 10; level++) {
      const requiredExp = realmBase * BigInt(level);
      await client.cultivationLevel.upsert({
        where: {
          tenantId_realmOrder_level: {
            tenantId,
            realmOrder: realm.realmOrder,
            level,
          },
        },
        update: {
          requiredExp,
        },
        create: {
          tenantId,
          realmOrder: realm.realmOrder,
          level,
          requiredExp,
        },
      });
    }
  }

  // 3. Seed Default Configurations
  for (const [key, val] of Object.entries(DEFAULT_GAME_CONFIG_VALUES)) {
    await client.gameConfiguration.upsert({
      where: {
        tenantId_configKey: {
          tenantId,
          configKey: key,
        },
      },
      update: {
        configValue: val,
        revision: 1,
      },
      create: {
        tenantId,
        configKey: key,
        configValue: val,
        revision: 1,
      },
    });
  }
}

export async function seedTuTien(): Promise<void> {
  console.log('--- Starting Tu Tien Live Seeding ---');
  const tenants = await prisma.tenant.findMany();
  if (tenants.length === 0) {
    console.warn('No tenants found in database. Please run general seed first.');
    return;
  }

  for (const tenant of tenants) {
    console.log(`Seeding Tu Tien for tenant: ${tenant.name} (${tenant.id})`);
    await seedTenantTuTien(prisma, tenant.id);
  }
  console.log('--- Tu Tien Live Seeding Complete ---');
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  seedTuTien()
    .catch((err) => {
      console.error('Failed to seed Tu Tien Live:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
