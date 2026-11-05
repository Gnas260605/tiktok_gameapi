import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  defaultLevelTable,
  currentChanceBp,
} from '../../../src/services/game/cultivation-engine';

export interface BreakthroughSession {
  id: string;
  tenantId: string;
  playerId: string;
  liveSessionId?: string | null;
  sourceRealmOrder: number;
  targetRealmOrder: number;
  baseChanceBp: number;
  maxChanceBp: number;
  bonusDiamonds: bigint;
  giftBonusBp: number;
  finalChanceBp?: number | null;
  status: 'preparing' | 'resolving' | 'succeeded' | 'failed' | 'cancelled';
  configSnapshot: any;
  trigger: 'chat' | 'api';
  startedAt: Date;
  endsAt: Date;
  endedAt?: Date | null;
}

export interface BreakthroughHistory {
  id: string;
  tenantId: string;
  playerId: string;
  sessionId: string;
  result: 'success' | 'failure';
  roll: number;
  finalChanceBp: number;
  cultivationPenalty: bigint;
  expBefore: bigint;
  expAfter: bigint;
  realmBefore: number;
  realmAfter: number;
  createdAt: Date;
}

const serviceTsPath = path.resolve(__dirname, '../../../src/services/game/breakthrough.service.ts');
const serviceJsPath = path.resolve(__dirname, '../../../src/services/game/breakthrough.service.js');
const isServiceImplemented = fs.existsSync(serviceTsPath) || fs.existsSync(serviceJsPath);

const serviceModulePath = '../../../src/services/game/breakthrough.service';
let BreakthroughServiceClass: any = null;

describe('BreakthroughService — Unit & Contract Tests (TC-B01 to TC-B10)', () => {
  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  const playerId = 'p0000000-0000-0000-0000-000000000001';
  const sessionId = 's0000000-0000-0000-0000-000000000001';

  let mockBreakthroughRepo: any;
  let mockPlayerRepo: any;
  let mockConfigService: any;
  let mockEventRepo: any;
  let serviceInstance: any;

  beforeAll(async () => {
    if (isServiceImplemented) {
      const mod = await import(/* @vite-ignore */ serviceModulePath).catch(() => null);
      if (mod) {
        BreakthroughServiceClass = mod.BreakthroughService;
      }
    }
  });

  beforeEach(() => {
    mockBreakthroughRepo = {
      createSession: vi.fn(),
      findActiveSessionByPlayer: vi.fn(),
      countActiveSessions: vi.fn().mockResolvedValue(0),
      findById: vi.fn(),
      updateSessionStatus: vi.fn(),
      updateSessionBonus: vi.fn(),
      resolveSessionAtomically: vi.fn(),
      createHistory: vi.fn(),
    };

    mockPlayerRepo = {
      findById: vi.fn(),
      updatePlayer: vi.fn(),
    };

    mockConfigService = {
      getConfig: vi.fn().mockResolvedValue({
        revision: 1,
        values: {
          gameEnabled: true,
          preparationSeconds: 30,
          cooldownSeconds: 300,
          failurePenaltyRatio: 0.2,
          maxChanceBp: 9500,
          maxConcurrentBreakthroughs: 3,
        },
      }),
      getRealms: vi.fn().mockResolvedValue([
        { realmOrder: 1, name: 'Luyện Khí', baseChanceBp: 9000, chanceBpPer100Diamonds: 1000 },
        { realmOrder: 2, name: 'Trúc Cơ', baseChanceBp: 8000, chanceBpPer100Diamonds: 400 },
        { realmOrder: 8, name: 'Đại Thừa', baseChanceBp: null, chanceBpPer100Diamonds: null },
      ]),
      getLevelTable: vi.fn().mockResolvedValue(defaultLevelTable),
    };

    mockEventRepo = {
      createEvent: vi.fn().mockResolvedValue({ id: 'evt-1', seq: 100n }),
    };

    if (BreakthroughServiceClass) {
      serviceInstance = new BreakthroughServiceClass(
        mockBreakthroughRepo,
        mockPlayerRepo,
        mockConfigService,
        mockEventRepo
      );
    }
  });

  it('reports module implementation status (TDD check)', () => {
    if (!isServiceImplemented) {
      console.info(
        'ℹ [TDD Pending] src/services/game/breakthrough.service.ts is awaiting implementation by Agent 2 in Phase 4.'
      );
    }
    expect(true).toBe(true);
  });

  // TC-B01: Khởi tạo phiên độ kiếp hợp lệ khi người chơi ở tầng 10 (Đại Viên Mãn)
  describe('TC-B01 — Valid Breakthrough Initiation', () => {
    it.skipIf(!isServiceImplemented)('TC-B01: initiates breakthrough session when player is level 10 with sufficient exp, no cooldown, no active session', async () => {
      const now = new Date('2026-11-05T12:00:00Z');
      vi.setSystemTime(now);

      const playerLK10 = {
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 10000n, // exactly required for LK10 Đại Viên Mãn
        breakthroughCooldownUntil: null,
      };

      mockPlayerRepo.findById.mockResolvedValue(playerLK10);
      mockBreakthroughRepo.findActiveSessionByPlayer.mockResolvedValue(null);
      mockBreakthroughRepo.countActiveSessions.mockResolvedValue(0);

      const expectedEndsAt = new Date(now.getTime() + 30 * 1000);
      mockBreakthroughRepo.createSession.mockResolvedValue({
        id: sessionId,
        tenantId,
        playerId,
        sourceRealmOrder: 1,
        targetRealmOrder: 2,
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        status: 'preparing',
        startedAt: now,
        endsAt: expectedEndsAt,
      });

      const session = await serviceInstance.startBreakthrough(tenantId, playerId, 'chat');

      expect(session).toBeDefined();
      expect(session.status).toBe('preparing');
      expect(session.sourceRealmOrder).toBe(1);
      expect(session.targetRealmOrder).toBe(2);
      expect(session.baseChanceBp).toBe(9000);
      expect(session.bonusDiamonds).toBe(0n);
      expect(session.giftBonusBp).toBe(0);
      expect(session.endsAt.getTime()).toBe(expectedEndsAt.getTime());

      // Emits breakthrough_started event
      expect(mockEventRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          eventType: 'breakthrough_started',
        })
      );

      vi.useRealTimers();
    });
  });

  // TC-B02: Từ chối độ kiếp khi chưa đạt tầng 10 hoặc chưa đủ tu vi Đại Viên Mãn
  describe('TC-B02 — Rejection: Not Max Level or Insufficient Exp', () => {
    it.skipIf(!isServiceImplemented)('TC-B02: rejects breakthrough when player is below level 10', async () => {
      mockPlayerRepo.findById.mockResolvedValue({
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 9, // not level 10
        currentExp: 9000n,
        breakthroughCooldownUntil: null,
      });

      await expect(serviceInstance.startBreakthrough(tenantId, playerId, 'chat')).rejects.toThrow(
        /NOT_MAX_LEVEL|level 10/i
      );
    });

    it.skipIf(!isServiceImplemented)('TC-B02: rejects breakthrough when player is level 10 but exp < required(r, 10)', async () => {
      mockPlayerRepo.findById.mockResolvedValue({
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 8000n, // less than required 10.000n
        breakthroughCooldownUntil: null,
      });

      await expect(serviceInstance.startBreakthrough(tenantId, playerId, 'chat')).rejects.toThrow(
        /INSUFFICIENT_EXP|Đại Viên Mãn/i
      );
    });
  });

  // TC-B03: Từ chối độ kiếp khi đang trong thời gian hồi chiêu
  describe('TC-B03 — Rejection: Cooldown Active', () => {
    it.skipIf(!isServiceImplemented)('TC-B03: rejects breakthrough when now < breakthroughCooldownUntil', async () => {
      const now = new Date('2026-11-05T12:00:00Z');
      vi.setSystemTime(now);

      mockPlayerRepo.findById.mockResolvedValue({
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 10000n,
        breakthroughCooldownUntil: new Date('2026-11-05T12:03:00Z'), // 3 mins remaining
      });

      await expect(serviceInstance.startBreakthrough(tenantId, playerId, 'chat')).rejects.toThrow(
        /COOLDOWN/i
      );

      vi.useRealTimers();
    });
  });

  // TC-B04: Từ chối khi đã có 1 phiên độ kiếp đang mở
  describe('TC-B04 — Rejection: Already in Progress', () => {
    it.skipIf(!isServiceImplemented)('TC-B04: rejects breakthrough when player already has an open session', async () => {
      mockPlayerRepo.findById.mockResolvedValue({
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 10000n,
        breakthroughCooldownUntil: null,
      });

      // Existing active session in preparing
      mockBreakthroughRepo.findActiveSessionByPlayer.mockResolvedValue({
        id: 'existing-session',
        status: 'preparing',
      });

      await expect(serviceInstance.startBreakthrough(tenantId, playerId, 'chat')).rejects.toThrow(
        /ALREADY_IN_PROGRESS|already open/i
      );
    });
  });

  // TC-B05: Từ chối độ kiếp ở Đại Thừa đỉnh phong (TC-B20)
  describe('TC-B05 — Rejection: Pinnacle Realm (Đại Thừa)', () => {
    it.skipIf(!isServiceImplemented)('TC-B05: rejects breakthrough at Realm 8 (Đại Thừa - max realm v1)', async () => {
      mockPlayerRepo.findById.mockResolvedValue({
        id: playerId,
        tenantId,
        realmOrder: 8, // Đại Thừa
        level: 10,
        currentExp: 6100000n,
        breakthroughCooldownUntil: null,
      });

      await expect(serviceInstance.startBreakthrough(tenantId, playerId, 'chat')).rejects.toThrow(
        /MAX_REALM|Cannot breakthrough at realm 8/i
      );
    });
  });

  // TC-B06: Quà tặng trong 30s độ kiếp cộng dồn bonus tỷ lệ thành công (chanceBonusBp), không vượt trần maxBp (95%)
  describe('TC-B06 — Gift Bonus Accumulation & 95% Cap', () => {
    it.skipIf(!isServiceImplemented)('TC-B06: adds bonus chance from gifts during 30s window and caps at 9500 bp', async () => {
      const activeSession: BreakthroughSession = {
        id: sessionId,
        tenantId,
        playerId,
        sourceRealmOrder: 1, // LK base = 9000, bpPer100 = 1000
        targetRealmOrder: 2,
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        status: 'preparing',
        configSnapshot: {},
        trigger: 'chat',
        startedAt: new Date('2026-11-05T12:00:00Z'),
        endsAt: new Date('2026-11-05T12:00:30Z'),
      };

      mockBreakthroughRepo.findById.mockResolvedValue(activeSession);

      // Gift 1: 10 diamonds (+100 bp -> 9100 bp)
      const bonusDiamonds1 = 10n;
      const expectedBonusBp1 = 100;
      mockBreakthroughRepo.updateSessionBonus.mockResolvedValue({
        ...activeSession,
        bonusDiamonds: bonusDiamonds1,
        giftBonusBp: expectedBonusBp1,
      });

      const updated1 = await serviceInstance.addGiftBonus(
        tenantId,
        sessionId,
        bonusDiamonds1,
        new Date('2026-11-05T12:00:10Z')
      );
      expect(updated1.giftBonusBp).toBe(expectedBonusBp1);
      expect(currentChanceBp(9000, bonusDiamonds1, 1000, 9500)).toBe(9100);

      // Gift 2: 1000 diamonds (Galaxy) -> hits max cap 9500 bp
      const totalDiamonds = 1010n;
      const expectedCappedChance = currentChanceBp(9000, totalDiamonds, 1000, 9500);
      expect(expectedCappedChance).toBe(9500);
    });
  });

  // TC-B07: Quà tặng đến sau khi hết 30s độ kiếp (occurredAt > ends_at) không được tính bonus tỷ lệ
  describe('TC-B07 — Overdue Gift Handling (occurredAt > ends_at)', () => {
    it.skipIf(!isServiceImplemented)('TC-B07: rejects bonus accumulation if gift occurredAt >= endsAt', async () => {
      const activeSession: BreakthroughSession = {
        id: sessionId,
        tenantId,
        playerId,
        sourceRealmOrder: 1,
        targetRealmOrder: 2,
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        status: 'preparing',
        configSnapshot: {},
        trigger: 'chat',
        startedAt: new Date('2026-11-05T12:00:00Z'),
        endsAt: new Date('2026-11-05T12:00:30Z'), // ends at 12:00:30
      };

      mockBreakthroughRepo.findById.mockResolvedValue(activeSession);

      // Gift arrives after endsAt (12:00:31)
      const lateTime = new Date('2026-11-05T12:00:31Z');
      const result = await serviceInstance.addGiftBonus(tenantId, sessionId, 100n, lateTime);

      // Should indicate expired window or return null / not updated
      expect(result.appliedAsBonus).toBe(false);
      expect(mockBreakthroughRepo.updateSessionBonus).not.toHaveBeenCalled();
    });
  });

  // TC-B08: Resolve độ kiếp thành công: roll < finalChanceBp -> status='succeeded', tăng realmOrder + 1, về tầng 1
  describe('TC-B08 — Success Resolution', () => {
    it.skipIf(!isServiceImplemented)('TC-B08: on roll < finalChanceBp, sets status=succeeded, advances realm, carries over surplus exp', async () => {
      const session: BreakthroughSession = {
        id: sessionId,
        tenantId,
        playerId,
        sourceRealmOrder: 1, // LK
        targetRealmOrder: 2, // TC
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        status: 'preparing',
        configSnapshot: { failurePenaltyRatio: 0.2 },
        trigger: 'chat',
        startedAt: new Date('2026-11-05T12:00:00Z'),
        endsAt: new Date('2026-11-05T12:00:30Z'),
      };

      // Player has 15000 exp (req10 = 10000, so 5000 surplus)
      const player = {
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 15000n,
        breakthroughSuccessCount: 0,
      };

      mockBreakthroughRepo.findById.mockResolvedValue(session);
      mockPlayerRepo.findById.mockResolvedValue(player);
      mockBreakthroughRepo.resolveSessionAtomically.mockResolvedValue({
        ...session,
        status: 'succeeded',
        finalChanceBp: 9000,
      });

      // Inject deterministic winning roll: 1000 < 9000
      const fixedRng = () => 1000;
      const resolution = await serviceInstance.resolveBreakthrough(tenantId, sessionId, fixedRng);

      expect(resolution.result).toBe('success');
      expect(resolution.session.status).toBe('succeeded');

      // In Realm 2 (Trúc Cơ), req(1) = 2500, req(2) = 5000
      // 5000 surplus consumes 2500 to level 2, leaving 2500 exp at level 2
      expect(mockPlayerRepo.updatePlayer).toHaveBeenCalledWith(
        tenantId,
        playerId,
        expect.objectContaining({
          realmOrder: 2,
          level: 2,
          currentExp: 2500n,
          breakthroughSuccessCount: 1,
        })
      );

      // BreakthroughHistory recorded with 0 penalty
      expect(mockBreakthroughRepo.createHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          playerId,
          sessionId,
          result: 'success',
          cultivationPenalty: 0n,
        })
      );

      // Emits breakthrough_succeeded event
      expect(mockEventRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          eventType: 'breakthrough_succeeded',
        })
      );
    });
  });

  // TC-B09: Resolve độ kiếp thất bại: roll >= finalChanceBp -> status='failed', giữ nguyên realmOrder, tầng 10, phạt tu vi dư 20%, cooldown 300s
  describe('TC-B09 — Failure Resolution', () => {
    it.skipIf(!isServiceImplemented)('TC-B09: on roll >= finalChanceBp, sets status=failed, deducts 20% surplus, triggers 300s cooldown', async () => {
      const now = new Date('2026-11-05T12:00:30Z');
      vi.setSystemTime(now);

      const session: BreakthroughSession = {
        id: sessionId,
        tenantId,
        playerId,
        sourceRealmOrder: 1,
        targetRealmOrder: 2,
        baseChanceBp: 9000,
        maxChanceBp: 9500,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        status: 'preparing',
        configSnapshot: { failurePenaltyRatio: 0.2, cooldownSeconds: 300 },
        trigger: 'chat',
        startedAt: new Date('2026-11-05T12:00:00Z'),
        endsAt: now,
      };

      // Player has 15000 exp (req10 = 10000, surplus = 5000)
      const player = {
        id: playerId,
        tenantId,
        realmOrder: 1,
        level: 10,
        currentExp: 15000n,
        breakthroughFailCount: 0,
      };

      mockBreakthroughRepo.findById.mockResolvedValue(session);
      mockPlayerRepo.findById.mockResolvedValue(player);
      mockBreakthroughRepo.resolveSessionAtomically.mockResolvedValue({
        ...session,
        status: 'failed',
        finalChanceBp: 9000,
      });

      // Inject losing roll: 9500 >= 9000
      const fixedRng = () => 9500;
      const resolution = await serviceInstance.resolveBreakthrough(tenantId, sessionId, fixedRng);

      expect(resolution.result).toBe('failure');
      expect(resolution.session.status).toBe('failed');

      // Penalty: 20% of 5000 = 1000 exp
      const expectedExpAfterPenalty = 14000n;
      const expectedCooldown = new Date(now.getTime() + 300 * 1000);

      expect(mockPlayerRepo.updatePlayer).toHaveBeenCalledWith(
        tenantId,
        playerId,
        expect.objectContaining({
          realmOrder: 1,
          level: 10,
          currentExp: expectedExpAfterPenalty,
          breakthroughFailCount: 1,
          breakthroughCooldownUntil: expectedCooldown,
        })
      );

      // History recorded with 1000n penalty
      expect(mockBreakthroughRepo.createHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          playerId,
          sessionId,
          result: 'failure',
          cultivationPenalty: 1000n,
        })
      );

      // Emits breakthrough_failed event
      expect(mockEventRepo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          eventType: 'breakthrough_failed',
        })
      );

      vi.useRealTimers();
    });
  });

  // TC-B10: Idempotency resolution: Chỉ resolve đúng 1 lần
  describe('TC-B10 — Idempotent Resolution (Resolve Exactly Once)', () => {
    it.skipIf(!isServiceImplemented)('TC-B10: second resolution attempt on non-preparing session is rejected or returns null', async () => {
      // First resolve: atomic update succeeds
      mockBreakthroughRepo.resolveSessionAtomically
        .mockResolvedValueOnce({
          id: sessionId,
          status: 'resolving',
        })
        // Second resolve: atomic update returns null (status was already changed from preparing)
        .mockResolvedValueOnce(null);

      const res1 = await serviceInstance.resolveBreakthrough(tenantId, sessionId);
      expect(res1).toBeDefined();

      const res2 = await serviceInstance.resolveBreakthrough(tenantId, sessionId);
      expect(res2).toBeNull();
    });
  });
});
