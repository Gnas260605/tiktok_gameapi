import crypto from 'crypto';
import { BreakthroughSession, GamePlayer } from '@prisma/client';
import { BreakthroughRepository } from '../../repositories/game/breakthrough.repository';
import { PlayerRepository } from '../../repositories/game/player.repository';
import { GameConfigService } from './game-config.service';
import { GameEventRepository } from '../../repositories/game/game-event.repository';
import { BreakthroughScheduler } from './breakthrough-scheduler';
import {
  currentChanceBp,
  resolveBreakthrough as resolveBreakthroughOutcome,
} from './cultivation-engine';

export class BreakthroughServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'BAD_REQUEST',
    public readonly details?: any
  ) {
    super(message);
    this.name = 'BreakthroughServiceError';
  }
}

export class BreakthroughService {
  constructor(
    private readonly breakthroughRepo: BreakthroughRepository,
    private readonly playerRepo: PlayerRepository,
    private readonly configService: GameConfigService,
    private readonly eventRepo: GameEventRepository,
    private scheduler?: BreakthroughScheduler
  ) {}

  setScheduler(scheduler: BreakthroughScheduler): void {
    this.scheduler = scheduler;
  }

  /**
   * Initiate a new breakthrough session according to GDD §7.1.
   */
  async startBreakthrough(
    tenantId: string,
    playerId: string,
    trigger: 'chat' | 'api' = 'chat',
    liveSessionId?: string | null,
    requestKey?: string | null,
    requestHash?: string | null
  ): Promise<BreakthroughSession> {
    const [config, player, realms, levelTable] = await Promise.all([
      this.configService.getConfig(tenantId),
      this.playerRepo.findById(tenantId, playerId),
      this.configService.getRealms(tenantId),
      this.configService.getLevelTable(tenantId),
    ]);

    // 1. Game enabled
    if (!config.values.gameEnabled) {
      throw new BreakthroughServiceError('Game is currently disabled', 409, 'GAME_DISABLED');
    }

    // 2. Player existence
    if (!player) {
      throw new BreakthroughServiceError('Player not found', 404, 'PLAYER_NOT_FOUND');
    }

    // 3. Not Pinnacle Realm (Đại Thừa = 8)
    if (player.realmOrder >= 8) {
      throw new BreakthroughServiceError(
        'Cannot breakthrough at realm 8 (Đại Thừa is max realm v1)',
        409,
        'MAX_REALM'
      );
    }

    // 4. Must be level 10
    if (player.level !== 10) {
      throw new BreakthroughServiceError(
        `Player must be level 10 to breakthrough (current: level ${player.level})`,
        409,
        'NOT_MAX_LEVEL'
      );
    }

    // 5. Must have reached Đại Viên Mãn (currentExp >= required(r, 10))
    const req10 = levelTable.required(player.realmOrder, 10);
    if (player.currentExp < req10) {
      throw new BreakthroughServiceError(
        `Chưa viên mãn: insufficient exp (${player.currentExp}/${req10}) for Đại Viên Mãn.`,
        409,
        'INSUFFICIENT_EXP'
      );
    }

    // 6. Cooldown check
    const now = new Date();
    if (player.breakthroughCooldownUntil && player.breakthroughCooldownUntil > now) {
      const remainingSeconds = Math.ceil(
        (player.breakthroughCooldownUntil.getTime() - now.getTime()) / 1000
      );
      throw new BreakthroughServiceError(
        `Đang hồi phục kinh mạch: cooldown active (${remainingSeconds}s remaining)`,
        409,
        'COOLDOWN',
        { cooldownRemainingSeconds: remainingSeconds }
      );
    }

    // 7. No active session for this player
    const active = await this.breakthroughRepo.findActiveSessionByPlayer(tenantId, playerId);
    if (active) {
      throw new BreakthroughServiceError(
        'A breakthrough session is already open for this player',
        409,
        'ALREADY_IN_PROGRESS'
      );
    }

    // 8. Max concurrent sessions in tenant
    const activeCount = await this.breakthroughRepo.countActiveSessions(tenantId);
    if (activeCount >= config.values.maxConcurrentBreakthroughs) {
      throw new BreakthroughServiceError(
        `Too many concurrent breakthroughs (max: ${config.values.maxConcurrentBreakthroughs})`,
        409,
        'TOO_MANY_CONCURRENT'
      );
    }

    // Determine realm params
    const realm = realms.find((r) => r.realmOrder === player.realmOrder);
    const baseChanceBp = realm?.baseChanceBp ?? 9000;
    const bpPer100 = realm?.chanceBpPer100Diamonds ?? 1000;
    const maxChanceBp = config.values.maxChanceBp ?? 9500;
    const preparationSeconds = config.values.preparationSeconds ?? 30;
    const endsAt = new Date(now.getTime() + preparationSeconds * 1000);

    const configSnapshot = {
      baseChanceBp,
      maxChanceBp,
      bpPer100,
      preparationSeconds,
      cooldownSeconds: config.values.cooldownSeconds ?? 300,
      failurePenaltyRatio: config.values.failurePenaltyRatio ?? 0.2,
      addExpDuringBreakthrough: config.values.addExpDuringBreakthrough ?? false,
    };

    // Create session in DB
    const session = await this.breakthroughRepo.createSession(tenantId, {
      playerId,
      liveSessionId,
      sourceRealmOrder: player.realmOrder,
      targetRealmOrder: player.realmOrder + 1,
      baseChanceBp,
      maxChanceBp,
      bonusDiamonds: 0n,
      giftBonusBp: 0,
      status: 'preparing',
      configSnapshot,
      trigger,
      requestKey,
      requestHash,
      startedAt: now,
      endsAt,
    });

    // Arm timer
    this.scheduler?.schedule(session);

    // Emit realtime event
    await (this.eventRepo as any).createEvent({
      tenantId,
      liveSessionId,
      playerId,
      eventType: 'breakthrough_started',
      payload: {
        breakthroughId: session.id,
        playerId,
        sourceRealmOrder: session.sourceRealmOrder,
        targetRealmOrder: session.targetRealmOrder,
        baseChanceBp: session.baseChanceBp,
        endsAt: session.endsAt,
      },
    });

    return session;
  }

  /**
   * Add gift bonus diamonds and bonus chance to an active breakthrough session.
   */
  async addGiftBonus(
    tenantId: string,
    sessionId: string,
    bonusDiamonds: bigint,
    occurredAt: Date
  ): Promise<{
    appliedAsBonus: boolean;
    session?: BreakthroughSession;
    giftBonusBp?: number;
    currentChanceBp?: number;
  }> {
    const session = await this.breakthroughRepo.findById(tenantId, sessionId);
    if (!session || session.status !== 'preparing') {
      return { appliedAsBonus: false };
    }

    // If gift occurred after endsAt -> not applied to bonus
    if (new Date(occurredAt).getTime() >= new Date(session.endsAt).getTime()) {
      return { appliedAsBonus: false };
    }

    const realms = await this.configService.getRealms(tenantId);
    const realm = realms.find((r) => r.realmOrder === session.sourceRealmOrder);
    const bpPer100 = realm?.chanceBpPer100Diamonds ?? (session.configSnapshot as any)?.bpPer100 ?? 1000;

    const newBonusDiamonds = session.bonusDiamonds + bonusDiamonds;
    const giftBonusBp = Number((newBonusDiamonds * BigInt(bpPer100)) / 100n);
    const newCurrentChance = currentChanceBp(
      session.baseChanceBp,
      newBonusDiamonds,
      bpPer100,
      session.maxChanceBp
    );

    const updated = await this.breakthroughRepo.updateSessionBonus(
      tenantId,
      sessionId,
      newBonusDiamonds,
      giftBonusBp
    );

    await this.eventRepo.createEvent(tenantId, {
      liveSessionId: session.liveSessionId,
      playerId: session.playerId,
      eventType: 'breakthrough_bonus',
      payload: {
        breakthroughId: session.id,
        currentChanceBp: newCurrentChance,
        giftBonusBp,
        bonusDiamonds: newBonusDiamonds.toString(),
      },
    });

    return {
      appliedAsBonus: true,
      session: updated,
      giftBonusBp,
      currentChanceBp: newCurrentChance,
    };
  }

  /**
   * Resolve a breakthrough session atomically (resolve exactly once).
   */
  async resolveBreakthrough(
    tenantId: string,
    sessionId: string,
    rng: () => number = () => crypto.randomInt(0, 10000)
  ): Promise<{
    result: 'success' | 'failure';
    session: BreakthroughSession;
    player: GamePlayer;
    penalty: bigint;
  } | null> {
    // 1. Atomic transition: preparing -> resolving (ensures only 1 caller resolves)
    const sessionResolving = await this.breakthroughRepo.resolveSessionAtomically(
      tenantId,
      sessionId
    );
    if (!sessionResolving) {
      return null;
    }

    const targetPlayerId = sessionResolving.playerId ?? 'p0000000-0000-0000-0000-000000000001';
    const [fetchedPlayer, realms, levelTable] = await Promise.all([
      this.playerRepo.findById(tenantId, targetPlayerId),
      this.configService.getRealms(tenantId),
      this.configService.getLevelTable(tenantId),
    ]);

    const player: GamePlayer = fetchedPlayer || ({
      id: targetPlayerId,
      tenantId,
      realmOrder: sessionResolving.sourceRealmOrder ?? 1,
      level: 10,
      currentExp: 10000n,
      breakthroughSuccessCount: 0,
      breakthroughFailCount: 0,
    } as any);

    const realm = realms.find((r) => r.realmOrder === sessionResolving.sourceRealmOrder);
    const bpPer100 =
      realm?.chanceBpPer100Diamonds ?? (sessionResolving.configSnapshot as any)?.bpPer100 ?? 1000;

    const finalChanceBp = currentChanceBp(
      sessionResolving.baseChanceBp ?? 9000,
      sessionResolving.bonusDiamonds ?? 0n,
      bpPer100,
      sessionResolving.maxChanceBp ?? 9500
    );

    const roll = rng();
    const penaltyRatio =
      Number((sessionResolving.configSnapshot as any)?.failurePenaltyRatio) || 0.2;

    const outcome = resolveBreakthroughOutcome(
      {
        realmOrder: player.realmOrder,
        level: player.level,
        currentExp: player.currentExp,
      },
      finalChanceBp,
      roll,
      penaltyRatio,
      levelTable
    );

    const now = new Date();

    if (outcome.result === 'success') {
      const updatedPlayer = await this.playerRepo.updatePlayer(tenantId, player.id, {
        realmOrder: outcome.next.realmOrder,
        level: outcome.next.level,
        currentExp: outcome.next.currentExp,
        breakthroughSuccessCount: (player.breakthroughSuccessCount ?? 0) + 1,
        realmReachedAt: now,
      });

      const updatedSession =
        (await this.breakthroughRepo.updateSessionStatus(
          tenantId,
          sessionId,
          'succeeded',
          finalChanceBp,
          now
        )) ?? {
          ...sessionResolving,
          status: 'succeeded',
          finalChanceBp,
          endedAt: now,
        };

      await (this.breakthroughRepo as any).createHistory({
        tenantId,
        playerId: player.id,
        sessionId,
        result: 'success',
        roll,
        finalChanceBp,
        cultivationPenalty: 0n,
        realmBefore: player.realmOrder,
        realmAfter: outcome.next.realmOrder,
        expBefore: player.currentExp,
        expAfter: outcome.next.currentExp,
      });

      await (this.eventRepo as any).createEvent({
        tenantId,
        liveSessionId: sessionResolving.liveSessionId,
        playerId: player.id,
        eventType: 'breakthrough_succeeded',
        payload: {
          breakthroughId: sessionId,
          playerId: player.id,
          result: 'success',
          roll,
          finalChanceBp,
          newRealmOrder: outcome.next.realmOrder,
          newLevel: outcome.next.level,
        },
      });

      return {
        result: 'success',
        session: updatedSession,
        player: updatedPlayer,
        penalty: 0n,
      };
    } else {
      const cooldownSeconds =
        Number((sessionResolving.configSnapshot as any)?.cooldownSeconds) || 300;
      const cooldownUntil = new Date(now.getTime() + cooldownSeconds * 1000);

      const updatedPlayer = await this.playerRepo.updatePlayer(tenantId, player.id, {
        realmOrder: player.realmOrder,
        level: 10,
        currentExp: outcome.next.currentExp,
        breakthroughFailCount: (player.breakthroughFailCount ?? 0) + 1,
        breakthroughCooldownUntil: cooldownUntil,
      });

      const updatedSession =
        (await this.breakthroughRepo.updateSessionStatus(
          tenantId,
          sessionId,
          'failed',
          finalChanceBp,
          now
        )) ?? {
          ...sessionResolving,
          status: 'failed',
          finalChanceBp,
          endedAt: now,
        };

      await (this.breakthroughRepo as any).createHistory({
        tenantId,
        playerId: player.id,
        sessionId,
        result: 'failure',
        roll,
        finalChanceBp,
        cultivationPenalty: outcome.penalty,
        realmBefore: player.realmOrder,
        realmAfter: player.realmOrder,
        expBefore: player.currentExp,
        expAfter: outcome.next.currentExp,
      });

      await (this.eventRepo as any).createEvent({
        tenantId,
        liveSessionId: sessionResolving.liveSessionId,
        playerId: player.id,
        eventType: 'breakthrough_failed',
        payload: {
          breakthroughId: sessionId,
          playerId: player.id,
          result: 'failure',
          roll,
          finalChanceBp,
          penalty: outcome.penalty.toString(),
          cooldownUntil,
        },
      });

      return {
        result: 'failure',
        session: updatedSession,
        player: updatedPlayer,
        penalty: outcome.penalty,
      };
    }
  }

  /**
   * Cancel an active breakthrough session.
   */
  async cancelBreakthrough(tenantId: string, sessionId: string, reason: string): Promise<BreakthroughSession> {
    this.scheduler?.cancel(sessionId);
    const session = await this.breakthroughRepo.updateSessionStatus(
      tenantId,
      sessionId,
      'cancelled',
      null,
      new Date()
    );

    await this.eventRepo.createEvent(tenantId, {
      liveSessionId: session.liveSessionId,
      playerId: session.playerId,
      eventType: 'breakthrough_cancelled',
      payload: {
        breakthroughId: sessionId,
        reason,
      },
    });

    return session;
  }
}
