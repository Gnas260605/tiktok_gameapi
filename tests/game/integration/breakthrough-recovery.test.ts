import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';

export interface BreakthroughSessionSummary {
  id: string;
  tenantId: string;
  playerId: string;
  status: 'preparing' | 'resolving' | 'succeeded' | 'failed' | 'cancelled';
  endsAt: Date;
}

const schedulerTsPath = path.resolve(__dirname, '../../../src/services/game/breakthrough-scheduler.ts');
const schedulerJsPath = path.resolve(__dirname, '../../../src/services/game/breakthrough-scheduler.js');
const isSchedulerImplemented = fs.existsSync(schedulerTsPath) || fs.existsSync(schedulerJsPath);

const schedulerModulePath = '../../../src/services/game/breakthrough-scheduler';
let BreakthroughSchedulerClass: any = null;

describe('Breakthrough Recovery & Lifecycle — Integration Tests (TC-B15 / TC-B16)', () => {
  const tenantId = 'a0000000-0000-0000-0000-000000000001';
  const sessionId1 = 'b0000000-0000-0000-0000-000000000001';
  const sessionId2 = 'b0000000-0000-0000-0000-000000000002';
  const playerId = 'p0000000-0000-0000-0000-000000000001';

  let mockBreakthroughRepo: any;
  let mockBreakthroughService: any;
  let schedulerInstance: any;

  beforeAll(async () => {
    if (isSchedulerImplemented) {
      const mod = await import(/* @vite-ignore */ schedulerModulePath).catch(() => null);
      if (mod) {
        BreakthroughSchedulerClass = mod.BreakthroughScheduler;
      }
    }
  });

  beforeEach(() => {
    mockBreakthroughRepo = {
      findDuePreparingSessions: vi.fn(),
      findActivePreparingSessions: vi.fn(),
    };

    mockBreakthroughService = {
      resolveBreakthrough: vi.fn().mockResolvedValue({
        result: 'success',
        session: { id: sessionId1, status: 'succeeded' },
      }),
    };

    if (BreakthroughSchedulerClass) {
      schedulerInstance = new BreakthroughSchedulerClass(
        mockBreakthroughService,
        mockBreakthroughRepo
      );
    }
  });

  it('reports module implementation status (TDD check)', () => {
    if (!isSchedulerImplemented) {
      console.info(
        'ℹ [TDD Pending] src/services/game/breakthrough-scheduler.ts is awaiting implementation by Agent 2 in Phase 4.'
      );
    }
    expect(true).toBe(true);
  });

  // TC-B15: Boot recovery — Phiên 'preparing' chưa hết 30s -> scheduler tái kích hoạt timer cho thời gian còn lại
  describe('TC-B15 — Boot Recovery for Active Preparing Sessions (ends_at > now)', () => {
    it.skipIf(!isSchedulerImplemented)('TC-B15: re-arms timer for remaining duration when server boots while session is still preparing', async () => {
      vi.useFakeTimers();
      const bootTime = new Date('2026-11-05T12:00:20Z'); // 20s after start
      vi.setSystemTime(bootTime);

      const endsAt = new Date('2026-11-05T12:00:30Z'); // 10s remaining
      const activeSession: BreakthroughSessionSummary = {
        id: sessionId1,
        tenantId,
        playerId,
        status: 'preparing',
        endsAt,
      };

      mockBreakthroughRepo.findActivePreparingSessions.mockResolvedValue([activeSession]);

      // Trigger recovery on boot
      await schedulerInstance.recover();

      // Verify that resolve has NOT been called immediately because endsAt > now
      expect(mockBreakthroughService.resolveBreakthrough).not.toHaveBeenCalled();

      // Advance clock by 9.9 seconds (not yet due)
      await vi.advanceTimersByTimeAsync(9900);
      expect(mockBreakthroughService.resolveBreakthrough).not.toHaveBeenCalled();

      // Advance past remaining time (total 10 seconds)
      await vi.advanceTimersByTimeAsync(200);

      // Verify resolve is triggered once the remaining timer expires
      expect(mockBreakthroughService.resolveBreakthrough).toHaveBeenCalledWith(tenantId, sessionId1);

      vi.useRealTimers();
    });
  });

  // TC-B16: Boot recovery — Phiên 'preparing' đã quá hạn 30s lúc khởi động -> scheduler lập tức kích hoạt resolve ngay
  describe('TC-B16 — Boot Recovery for Overdue Preparing Sessions (ends_at <= now)', () => {
    it.skipIf(!isSchedulerImplemented)('TC-B16: immediately triggers resolve for overdue sessions on server restart without leaving player stuck', async () => {
      vi.useFakeTimers();
      // Server crashed at 12:00:15 (ends_at was 12:00:30) and server boots at 12:01:00 (30s past ends_at)
      const overdueBootTime = new Date('2026-11-05T12:01:00Z');
      vi.setSystemTime(overdueBootTime);

      const overdueEndsAt = new Date('2026-11-05T12:00:30Z');
      const overdueSession: BreakthroughSessionSummary = {
        id: sessionId2,
        tenantId,
        playerId,
        status: 'preparing',
        endsAt: overdueEndsAt,
      };

      mockBreakthroughRepo.findActivePreparingSessions.mockResolvedValue([overdueSession]);

      // Trigger recovery on boot
      await schedulerInstance.recover();

      // Overdue session must be resolved immediately to unblock player
      expect(mockBreakthroughService.resolveBreakthrough).toHaveBeenCalledWith(tenantId, sessionId2);

      vi.useRealTimers();
    });
  });
});
