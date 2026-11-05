import { PrismaClient, GiftTransaction, GamePlayer, GiftTxType } from '@prisma/client';
import { GameConfigService } from './game-config.service';
import { PlayerService, UserInput } from './player.service';
import { applyExp, isMaxLevel } from './cultivation-engine';
import { GameRealtimeGateway } from './game-realtime.gateway';

export interface GiftHandlingResult {
  transaction: GiftTransaction | null;
  skipped?: boolean;
  reason?: string;
  tuViAdded?: bigint;
  bonusChanceBp?: number;
}

/**
 * GiftHandler - Idempotent, transaction-safe gift processing for Tu Tien Live.
 * References:
 * - docs/game/01_GDD.md §5, §6.2, §7.3, §8
 * - docs/game/05_Architecture.md §4, §5
 * - docs/game/AUDIT.md §4.4, §5
 */
export class GiftHandler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: GameConfigService,
    private readonly playerService: PlayerService,
    private readonly realtimeGateway?: GameRealtimeGateway
  ) {}

  /**
   * Primary entry point for processing a gift event emitted from GameEventBus.
   */
  async handleGift(
    tenantId: string,
    sessionId: string,
    persistedEvent: any,
    persistedUser: any
  ): Promise<GiftHandlingResult> {
    const payload = persistedEvent?.data || {};

    // 1. Combo check: connector emits settled message with repeatEnd=true
    if (payload.repeatEnd !== true) {
      return { skipped: true, reason: 'NOT_FINAL_COMBO', transaction: null };
    }

    // 2. Derive deterministic idempotency key (AUDIT.md §5)
    const rawKeyPart =
      persistedEvent.sourceEventId ||
      persistedEvent.payloadFingerprint ||
      persistedEvent.id;
    const idempotencyKey = `gift:v1:${rawKeyPart}`.slice(0, 160);

    const giftId = String(payload.giftId || 'unknown');
    const giftName = String(payload.giftName || 'Unknown Gift');
    const diamondValue =
      payload.diamondCount !== undefined && payload.diamondCount !== null
        ? Number(payload.diamondCount)
        : null;
    const giftQuantity = Math.max(1, Number(payload.repeatCount) || 1);

    // Fallback formula for MockConnector (AUDIT.md §4.4)
    const rawTotalDiamonds =
      diamondValue !== null
        ? payload.totalDiamonds ?? diamondValue * giftQuantity
        : null;
    const totalDiamonds =
      rawTotalDiamonds !== null && rawTotalDiamonds !== undefined
        ? BigInt(rawTotalDiamonds)
        : 0n;

    const occurredAt = persistedEvent.occurredAt
      ? new Date(persistedEvent.occurredAt)
      : new Date();

    // Validate eventId is a valid UUID and exists in DB to prevent foreign key errors
    let eventId: string | null = null;
    const isValidUuid =
      typeof persistedEvent?.id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(persistedEvent.id);

    if (isValidUuid) {
      const existingEvent = await this.prisma.event.findUnique({
        where: { tenantId_id: { tenantId, id: persistedEvent.id } },
        select: { id: true },
      });
      if (existingEvent) {
        eventId = persistedEvent.id;
      }
    }

    // 3. Step 1: INSERT gift_transactions(status='pending') BEFORE any mutation
    let transaction: GiftTransaction;
    try {
      transaction = await this.prisma.giftTransaction.create({
        data: {
          tenantId,
          idempotencyKey,
          eventId,
          liveSessionId: sessionId,
          userId: persistedUser.id,
          giftId,
          giftName,
          diamondValue,
          giftQuantity,
          totalDiamonds,
          status: 'pending',
          transactionType: diamondValue === null ? 'unpriced' : 'cultivation',
          occurredAt,
        },
      });
    } catch (err: any) {
      // P2002 Unique Violation -> already processed or currently processing
      if (err.code === 'P2002') {
        const existing = await this.prisma.giftTransaction.findUnique({
          where: {
            tenantId_idempotencyKey: {
              tenantId,
              idempotencyKey,
            },
          },
        });
        return {
          skipped: true,
          reason: 'ALREADY_PROCESSED',
          transaction: existing,
        };
      }
      throw err;
    }

    // 4. Check for unpriced gift (diamondCount is null)
    if (diamondValue === null) {
      return {
        transaction,
        skipped: true,
        reason: 'UNPRICED_GIFT',
      };
    }

    // 5. Load tenant game configurations
    const config = await this.configService.getConfig(tenantId);

    // 6. Check gameEnabled & giftProcessingEnabled
    if (!config.values.gameEnabled || !config.values.giftProcessingEnabled) {
      const updated = await this.prisma.giftTransaction.update({
        where: { tenantId_id: { tenantId, id: transaction.id } },
        data: {
          status: 'applied',
          transactionType: 'ignored_game_disabled',
        },
      });
      return {
        transaction: updated,
        skipped: true,
        reason: 'GAME_OR_GIFTS_DISABLED',
      };
    }

    // 7. Find or Auto-Join Player
    let player = await this.playerService.getPlayerByUserId(tenantId, persistedUser.id);

    if (!player) {
      if (config.values.autoJoinOnGift) {
        const userInput: UserInput = {
          id: persistedUser.id,
          username: persistedUser.uniqueId || persistedUser.nickname || 'TuTiênGiả',
          nickname: persistedUser.nickname,
          avatarUrl: persistedUser.avatarUrl,
          platformUserId: persistedUser.platformUserId,
        };
        const joined = await this.playerService.joinOrReturn(
          tenantId,
          userInput,
          undefined,
          sessionId
        );
        player = joined.player;
      } else {
        // Player has not joined and autoJoinOnGift is false -> unjoined_pending
        const unjoinedTx = await this.prisma.giftTransaction.update({
          where: { tenantId_id: { tenantId, id: transaction.id } },
          data: {
            transactionType: 'unjoined_pending',
            status: 'pending',
          },
        });
        return {
          transaction: unjoinedTx,
          skipped: true,
          reason: 'UNJOINED_PENDING',
        };
      }
    }

    // 8. Execute gift processing inside transactional retry wrapper (40P01 / 40001)
    return this.executeWithRetry(
      async () => {
        return this.processPlayerGift(
          tenantId,
          sessionId,
          transaction,
          player!,
          totalDiamonds,
          occurredAt,
          giftName,
          payload.giftImageUrl || null,
          giftQuantity,
          config
        );
      },
      transaction.id,
      tenantId
    );
  }

  /**
   * Internal processor for applying gift to an active player.
   */
  private async processPlayerGift(
    tenantId: string,
    sessionId: string,
    txRow: GiftTransaction,
    player: GamePlayer,
    totalDiamonds: bigint,
    occurredAt: Date,
    giftName: string,
    giftImageUrl: string | null,
    giftQuantity: number,
    config: any
  ): Promise<GiftHandlingResult> {
    const realms = await this.configService.getRealms(tenantId);
    const levelTable = await this.configService.getLevelTable(tenantId);

    return this.prisma.$transaction(async (tx) => {
      // Lock and re-read player row strictly with SELECT ... FOR UPDATE
      const lockedPlayer = await tx.gamePlayer.findUnique({
        where: { tenantId_id: { tenantId, id: player.id } },
      });

      if (!lockedPlayer) {
        throw new Error(`Player ${player.id} not found during gift processing`);
      }

      // Check active breakthrough session (occurredAt < endsAt)
      const activeSession = await tx.breakthroughSession.findFirst({
        where: {
          tenantId,
          playerId: lockedPlayer.id,
          status: 'preparing',
          endsAt: { gt: occurredAt },
        },
      });

      // Branch A: Active Breakthrough Session
      if (activeSession) {
        const realm = realms.find((r) => r.realmOrder === lockedPlayer.realmOrder);
        const bpPer100 = realm?.chanceBpPer100Diamonds ?? 1000;
        const giftBonusBp = Number((totalDiamonds * BigInt(bpPer100)) / 100n);

        const newBonusDiamonds = activeSession.bonusDiamonds + totalDiamonds;
        const newGiftBonusBp = activeSession.giftBonusBp + giftBonusBp;
        const maxChanceBp = activeSession.maxChanceBp ?? config.values.maxChanceBp ?? 9500;
        const finalChanceBp = Math.min(activeSession.baseChanceBp + newGiftBonusBp, maxChanceBp);

        // Update breakthrough session
        await tx.breakthroughSession.update({
          where: { tenantId_id: { tenantId, id: activeSession.id } },
          data: {
            bonusDiamonds: newBonusDiamonds,
            giftBonusBp: newGiftBonusBp,
            finalChanceBp,
          },
        });

        // Determine if exp should also be granted
        let cultivationReceived = 0n;
        let txType: GiftTxType = 'breakthrough_bonus';

        if (config.values.addExpDuringBreakthrough) {
          const multiplier = BigInt(config.values.tuViMultiplier || 10);
          cultivationReceived = totalDiamonds * multiplier;
          txType = 'cultivation_and_bonus';

          await tx.gamePlayer.update({
            where: { tenantId_id: { tenantId, id: lockedPlayer.id } },
            data: {
              currentExp: lockedPlayer.currentExp + cultivationReceived,
              totalCultivation: lockedPlayer.totalCultivation + cultivationReceived,
              totalDiamondsGifted: lockedPlayer.totalDiamondsGifted + totalDiamonds,
              giftsReachedAt: new Date(),
              lastActiveAt: new Date(),
              version: { increment: 1 },
            },
          });
        } else {
          // Track diamonds gifted without adding exp
          await tx.gamePlayer.update({
            where: { tenantId_id: { tenantId, id: lockedPlayer.id } },
            data: {
              totalDiamondsGifted: lockedPlayer.totalDiamondsGifted + totalDiamonds,
              giftsReachedAt: new Date(),
              lastActiveAt: new Date(),
              version: { increment: 1 },
            },
          });
        }

        // Update gift transaction row
        const updatedTx = await tx.giftTransaction.update({
          where: { tenantId_id: { tenantId, id: txRow.id } },
          data: {
            playerId: lockedPlayer.id,
            breakthroughSessionId: activeSession.id,
            status: 'applied',
            transactionType: txType,
            chanceBonusBp: giftBonusBp,
            cultivationReceived,
          },
        });

        // Create game_event
        const gameEvent = await tx.gameEvent.create({
          data: {
            tenantId,
            liveSessionId: sessionId,
            playerId: lockedPlayer.id,
            eventType: 'breakthrough_bonus',
            payload: {
              breakthroughId: activeSession.id,
              playerId: lockedPlayer.id,
              currentChanceBp: finalChanceBp,
              giftName,
              totalDiamonds: totalDiamonds.toString(),
              bonusBp: giftBonusBp,
            },
          },
        });

        if (this.realtimeGateway) {
          this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, gameEvent);
        }

        return {
          transaction: updatedTx,
          bonusChanceBp: giftBonusBp,
          tuViAdded: cultivationReceived,
        };
      }

      // Branch B: Normal Exp / Cultivation Flow
      const tuViMultiplier = BigInt(config.values.tuViMultiplier || 10);
      const tuViToAdd = totalDiamonds * tuViMultiplier;

      const req10 = levelTable.required(lockedPlayer.realmOrder, 10);
      const maxOverflowRatio =
        typeof config.values.maxOverflowRatio === 'number'
          ? config.values.maxOverflowRatio
          : 3.0;
      const overflowCap = BigInt(Math.floor(Number(req10) * maxOverflowRatio));

      const { next, levelsGained, capped } = applyExp(
        {
          realmOrder: lockedPlayer.realmOrder,
          level: lockedPlayer.level,
          currentExp: lockedPlayer.currentExp,
        },
        tuViToAdd,
        levelTable,
        overflowCap
      );

      const txType: GiftTxType = capped > 0n ? 'overflow_capped' : 'cultivation';
      const now = new Date();

      // Update player
      const updatedPlayer = await tx.gamePlayer.update({
        where: { tenantId_id: { tenantId, id: lockedPlayer.id } },
        data: {
          realmOrder: next.realmOrder,
          level: next.level,
          currentExp: next.currentExp,
          totalCultivation: lockedPlayer.totalCultivation + tuViToAdd,
          totalDiamondsGifted: lockedPlayer.totalDiamondsGifted + totalDiamonds,
          cultivationReachedAt: now,
          giftsReachedAt: now,
          lastActiveAt: now,
          version: { increment: 1 },
        },
      });

      // Update gift transaction
      const updatedTx = await tx.giftTransaction.update({
        where: { tenantId_id: { tenantId, id: txRow.id } },
        data: {
          playerId: updatedPlayer.id,
          status: 'applied',
          transactionType: txType,
          cultivationReceived: tuViToAdd,
          realmBefore: lockedPlayer.realmOrder,
          levelBefore: lockedPlayer.level,
          expBefore: lockedPlayer.currentExp,
          realmAfter: next.realmOrder,
          levelAfter: next.level,
          expAfter: next.currentExp,
        },
      });

      // Emit exp_gained event
      const expEvent = await tx.gameEvent.create({
        data: {
          tenantId,
          liveSessionId: sessionId,
          playerId: updatedPlayer.id,
          eventType: 'exp_gained',
          payload: {
            playerId: updatedPlayer.id,
            amount: tuViToAdd.toString(),
            giftName,
            giftImageUrl,
            repeatCount: giftQuantity,
            progress: {
              realmOrder: next.realmOrder,
              level: next.level,
              currentExp: next.currentExp.toString(),
            },
          },
        },
      });

      if (this.realtimeGateway) {
        this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, expEvent);
      }

      // Emit level_up if levels were gained
      if (levelsGained.length > 0) {
        const levelUpEvent = await tx.gameEvent.create({
          data: {
            tenantId,
            liveSessionId: sessionId,
            playerId: updatedPlayer.id,
            eventType: 'level_up',
            payload: {
              playerId: updatedPlayer.id,
              levels: levelsGained,
              progress: {
                realmOrder: next.realmOrder,
                level: next.level,
                currentExp: next.currentExp.toString(),
              },
            },
          },
        });
        if (this.realtimeGateway) {
          this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, levelUpEvent);
        }
      }

      // Emit max_level_reached if reached level 10 threshold
      if (
        next.level === 10 &&
        isMaxLevel(next, levelTable) &&
        (lockedPlayer.level < 10 || !isMaxLevel(lockedPlayer, levelTable))
      ) {
        const maxLevelEvent = await tx.gameEvent.create({
          data: {
            tenantId,
            liveSessionId: sessionId,
            playerId: updatedPlayer.id,
            eventType: 'max_level_reached',
            payload: {
              playerId: updatedPlayer.id,
              message: 'Đại Viên Mãn, hãy gõ do kiep!',
            },
          },
        });
        if (this.realtimeGateway) {
          this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, maxLevelEvent);
        }
      }

      return {
        transaction: updatedTx,
        tuViAdded: tuViToAdd,
      };
    });
  }

  /**
   * Resolves unjoined pending gifts when user joins (GDD §6.2, TC-G06, TC-G07).
   */
  async claimPendingUnjoinedGifts(
    tenantId: string,
    userId: string,
    player: GamePlayer,
    sessionId?: string | null
  ): Promise<number> {
    const config = await this.configService.getConfig(tenantId);
    const ttlHours = config.values.pendingGiftTtlHours ?? 72;
    const ttlThreshold = new Date(Date.now() - ttlHours * 3600 * 1000);

    const pendingGifts = await this.prisma.giftTransaction.findMany({
      where: {
        tenantId,
        userId,
        status: 'pending',
        transactionType: 'unjoined_pending',
      },
    });

    if (pendingGifts.length === 0) return 0;

    let claimedCount = 0;
    for (const giftTx of pendingGifts) {
      if (giftTx.occurredAt < ttlThreshold) {
        // Expired
        await this.prisma.giftTransaction.update({
          where: { tenantId_id: { tenantId, id: giftTx.id } },
          data: { status: 'expired' },
        });
      } else {
        // Valid within TTL -> apply
        await this.executeWithRetry(
          async () => {
            return this.processPlayerGift(
              tenantId,
              sessionId || giftTx.liveSessionId,
              giftTx,
              player,
              giftTx.totalDiamonds,
              giftTx.occurredAt,
              giftTx.giftName,
              null,
              giftTx.giftQuantity,
              config
            );
          },
          giftTx.id,
          tenantId
        );
        claimedCount++;
      }
    }

    return claimedCount;
  }

  /**
   * Executes database operations with automatic deadlock / serialization retry (40P01 / 40001).
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    txId: string,
    tenantId: string,
    maxRetries: number = 5
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation();
      } catch (err: any) {
        attempt++;
        const isTransient =
          err.code === '40P01' ||
          err.code === '40001' ||
          err.message?.includes('deadlock') ||
          err.message?.includes('could not serialize');

        if (isTransient && attempt < maxRetries) {
          const jitter = 20 + Math.random() * 180;
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }

        // Exhausted retries or non-retryable error
        try {
          await this.prisma.giftTransaction.update({
            where: { tenantId_id: { tenantId, id: txId } },
            data: {
              status: 'failed',
              errorMessage: err.message,
            },
          });
        } catch {
          // ignore secondary update error
        }
        throw err;
      }
    }
  }
}
