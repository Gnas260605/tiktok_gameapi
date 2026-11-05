import { BreakthroughRepository } from '../../repositories/game/breakthrough.repository';

export interface BreakthroughSchedulerTarget {
  resolveBreakthrough(tenantId: string, sessionId: string, rng?: () => number): Promise<any>;
}

export class BreakthroughScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly breakthroughService: BreakthroughSchedulerTarget,
    private readonly breakthroughRepo: BreakthroughRepository
  ) {}

  /**
   * Schedule a timer to automatically resolve a preparing breakthrough session at endsAt.
   * Supports schedule({ id, tenantId, endsAt }) and schedule(tenantId, sessionId, endsAt).
   */
  schedule(
    sessionOrTenantId: string | { id: string; tenantId: string; endsAt: Date },
    sessionId?: string,
    endsAt?: Date
  ): void {
    const session =
      typeof sessionOrTenantId === 'string'
        ? { id: sessionId!, tenantId: sessionOrTenantId, endsAt: endsAt! }
        : sessionOrTenantId;

    // Clear any existing timer for this session
    this.cancel(session.id);

    const now = Date.now();
    const delay = Math.max(0, new Date(session.endsAt).getTime() - now);

    const timer = setTimeout(async () => {
      this.timers.delete(session.id);
      try {
        await this.breakthroughService.resolveBreakthrough(session.tenantId, session.id);
      } catch (err) {
        console.error(`[BreakthroughScheduler] Failed to resolve session ${session.id}:`, err);
      }
    }, delay);

    this.timers.set(session.id, timer);
  }

  /**
   * Cancel an active timer for a session.
   */
  cancel(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  /**
   * Clear all active timers.
   */
  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Recover all preparing sessions on server boot (TC-B15 / TC-B16).
   * - If endsAt <= now: resolve immediately.
   * - If endsAt > now: re-arm timer with remaining duration.
   */
  async recover(): Promise<void> {
    const sessions = await this.breakthroughRepo.findActivePreparingSessions();
    const now = Date.now();

    for (const session of sessions) {
      const endsAtTime = new Date(session.endsAt).getTime();
      if (endsAtTime <= now) {
        // Expired/overdue: resolve immediately
        try {
          await this.breakthroughService.resolveBreakthrough(session.tenantId, session.id);
        } catch (err) {
          console.error(
            `[BreakthroughScheduler] Recovery resolution failed for overdue session ${session.id}:`,
            err
          );
        }
      } else {
        // Still preparing: schedule remaining time
        this.schedule(session);
      }
    }
  }
}
