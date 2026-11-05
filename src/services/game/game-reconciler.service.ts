import { PrismaClient } from '@prisma/client';
import { GameEventProcessor } from './game-event-processor';

export interface ReconcilerOptions {
  intervalMs?: number;
  lookbackHours?: number;
  batchSize?: number;
}

/**
 * GameReconcilerService - Recovers missed gift events within a rolling 24-hour lookback window.
 * References:
 * - docs/game/05_Architecture.md §7, §10
 * - docs/game/07_TestPlan.md TC-G13
 */
export class GameReconcilerService {
  private readonly intervalMs: number;
  private readonly lookbackHours: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private isReconciling = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly processor: GameEventProcessor,
    options?: ReconcilerOptions
  ) {
    this.intervalMs =
      options?.intervalMs ??
      Number(process.env.GAME_RECONCILE_INTERVAL_MS || 30000);
    this.lookbackHours =
      options?.lookbackHours ??
      Number(process.env.GAME_RECONCILE_LOOKBACK_HOURS || 24);
    this.batchSize = options?.batchSize ?? 100;
  }

  /**
   * Starts periodic reconciliation and triggers an immediate sweep on boot.
   */
  public async start(): Promise<void> {
    // Immediate sweep on startup
    await this.reconcile();

    if (!this.timer) {
      this.timer = setInterval(() => {
        this.reconcile().catch((err) => {
          console.error(`[GameReconcilerService] Scheduled sweep error: ${err.message}`);
        });
      }, this.intervalMs);
    }
  }

  /**
   * Stops periodic reconciliation sweeps.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executes a single reconciliation pass:
   * Scans events (eventType = 'gift') within lookbackHours that have no matching gift_transactions.
   */
  public async reconcile(tenantId?: string): Promise<number> {
    if (this.isReconciling) return 0;
    this.isReconciling = true;

    try {
      const lookbackThreshold = new Date(
        Date.now() - this.lookbackHours * 3600 * 1000
      );

      const whereClause: any = {
        eventType: 'gift',
        createdAt: { gte: lookbackThreshold },
        giftTransactions: {
          none: {},
        },
      };

      if (tenantId) {
        whereClause.tenantId = tenantId;
      }

      const unhandledGiftEvents = await this.prisma.event.findMany({
        where: whereClause,
        include: {
          user: true,
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      });

      let reEnqueuedCount = 0;
      for (const event of unhandledGiftEvents) {
        if (!event.user) continue;

        this.processor.enqueue({
          tenantId: event.tenantId,
          sessionId: event.sessionId,
          event,
          user: event.user,
        });
        reEnqueuedCount++;
      }

      if (reEnqueuedCount > 0) {
        console.info(
          `[GameReconcilerService] Re-enqueued ${reEnqueuedCount} missing gift events.`
        );
      }

      return reEnqueuedCount;
    } finally {
      this.isReconciling = false;
    }
  }
}
