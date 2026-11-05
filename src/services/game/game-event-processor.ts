import { PrismaClient } from '@prisma/client';
import { GameEventBus, GameEventPayload } from './game-event-bus';
import { GiftHandler } from './gift-handler';
import { PlayerService, UserInput } from './player.service';
import { GameConfigService } from './game-config.service';
import { parseCommand, GameCommand } from './command-parser';
import { isMaxLevel } from './cultivation-engine';
import { GameRealtimeGateway } from './game-realtime.gateway';

export interface ProcessorMetrics {
  queueSize: number;
  activeTasks: number;
  processorLagMs: number;
  isBackpressureActive: boolean;
  totalProcessed: number;
  droppedCommands: number;
}

/**
 * GameEventProcessor - Sequential per-player FIFO event queue with global concurrency limit.
 * References:
 * - docs/game/05_Architecture.md §4
 * - docs/game/01_GDD.md §6, §7.1
 */
export class GameEventProcessor {
  private readonly playerQueues = new Map<string, Promise<void>>();
  private readonly userCommandCooldowns = new Map<string, number>();
  private readonly concurrencyLimit: number;
  private activeTasksCount = 0;
  private totalQueueSize = 0;
  private latestLagMs = 0;
  private totalProcessedCount = 0;
  private droppedCommandsCount = 0;
  private unsubscribeBus: (() => void) | null = null;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly gameEventBus: GameEventBus,
    private readonly giftHandler: GiftHandler,
    private readonly playerService: PlayerService,
    private readonly configService: GameConfigService,
    private readonly realtimeGateway?: GameRealtimeGateway,
    options?: { concurrency?: number }
  ) {
    this.concurrencyLimit =
      options?.concurrency ??
      Number(process.env.GAME_PROCESSOR_CONCURRENCY || 16);
  }

  /**
   * Starts listening to GameEventBus.
   */
  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.unsubscribeBus = this.gameEventBus.subscribe((payload) => {
      this.enqueue(payload);
    });
  }

  /**
   * Stops listening to GameEventBus and drains pending tasks.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }

    // Wait for all player queues to settle
    const pendingPromises = Array.from(this.playerQueues.values());
    await Promise.allSettled(pendingPromises);
    this.playerQueues.clear();
  }

  /**
   * Enqueues an ingested event for sequential execution per player.
   */
  public enqueue(payload: GameEventPayload): void {
    const { tenantId, sessionId, event, user } = payload;
    if (!event || !tenantId) return;

    // Track lag from occurredAt to now
    if (event.occurredAt) {
      const occurredTime = new Date(event.occurredAt).getTime();
      this.latestLagMs = Math.max(0, Date.now() - occurredTime);
    }

    // 1. Filter out intermediate combo gift events (must have repeatEnd === true)
    if (event.eventType === 'gift') {
      const giftData = event.data || {};
      if (giftData.repeatEnd !== true) {
        return; // Intermediate combo tap, ignored per Architecture §5
      }
    }

    // 2. Backpressure check (> 5000 tasks queued)
    const isBackpressure = this.totalQueueSize > 5000;
    if (isBackpressure && event.eventType === 'chat') {
      // Drop low priority chat commands under extreme load
      this.droppedCommandsCount++;
      console.warn(
        `[GameEventProcessor] Backpressure active (${this.totalQueueSize} tasks). Dropping chat event.`
      );
      return;
    }

    const userId = user?.id || event.userId || 'anonymous';
    const queueKey = `${tenantId}:${userId}`;

    this.totalQueueSize++;

    const previousPromise = this.playerQueues.get(queueKey) || Promise.resolve();

    const currentTask = previousPromise
      .then(async () => {
        await this.acquireConcurrencyPermit();
        try {
          await this.processEvent(tenantId, sessionId, event, user);
        } catch (err: any) {
          console.error(`[GameEventProcessor] Error processing event: ${err.message}`, err);
        } finally {
          this.releaseConcurrencyPermit();
          this.totalProcessedCount++;
          this.totalQueueSize--;
        }
      })
      .finally(() => {
        // Clean up queue map entry if this was the last pending task
        if (this.playerQueues.get(queueKey) === currentTask) {
          this.playerQueues.delete(queueKey);
        }
      });

    this.playerQueues.set(queueKey, currentTask);
  }

  /**
   * Concurrency semaphore: limits global concurrent DB tasks to concurrencyLimit.
   */
  private async acquireConcurrencyPermit(): Promise<void> {
    while (this.activeTasksCount >= this.concurrencyLimit) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    this.activeTasksCount++;
  }

  private releaseConcurrencyPermit(): void {
    this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
  }

  /**
   * Dispatches event to specialized handler (gift or chat command).
   */
  private async processEvent(
    tenantId: string,
    sessionId: string,
    event: any,
    user: any
  ): Promise<void> {
    if (event.eventType === 'gift') {
      await this.giftHandler.handleGift(tenantId, sessionId, event, user);
    } else if (event.eventType === 'chat') {
      await this.handleChat(tenantId, sessionId, event, user);
    }
  }

  /**
   * Parses and executes chat commands.
   */
  private async handleChat(
    tenantId: string,
    sessionId: string,
    event: any,
    user: any
  ): Promise<void> {
    const rawText = event.data?.text || event.data?.comment || '';
    const cmd = parseCommand(rawText);
    if (!cmd) return; // Not a game command

    const config = await this.configService.getConfig(tenantId);
    if (!config.values.gameEnabled) return;

    // Command spam cooldown check (GDD §6)
    const cooldownKey = `${tenantId}:${user.id}`;
    const now = Date.now();
    const lastCommandAt = this.userCommandCooldowns.get(cooldownKey) || 0;
    const cooldownLimitMs = (config.values.commandCooldownSeconds || 10) * 1000;

    if (
      cmd.type === 'info' ||
      cmd.type === 'cultivation' ||
      cmd.type === 'realm' ||
      cmd.type === 'leaderboard' ||
      cmd.type === 'top'
    ) {
      if (now - lastCommandAt < cooldownLimitMs) {
        // Silently drop spam command
        return;
      }
      this.userCommandCooldowns.set(cooldownKey, now);
    }

    const userInput: UserInput = {
      id: user.id,
      username: user.uniqueId || user.nickname || 'TuTiênGiả',
      nickname: user.nickname,
      avatarUrl: user.avatarUrl,
      platformUserId: user.platformUserId,
    };

    switch (cmd.type) {
      case 'join': {
        const joined = await this.playerService.joinOrReturn(
          tenantId,
          userInput,
          cmd.gender,
          sessionId
        );
        // Claim any unjoined gifts pending in DB
        await this.giftHandler.claimPendingUnjoinedGifts(
          tenantId,
          user.id,
          joined.player,
          sessionId
        );
        break;
      }

      case 'gender': {
        const player = await this.playerService.getPlayerByUserId(tenantId, user.id);
        if (!player) {
          await this.emitCommandRejected(
            tenantId,
            sessionId,
            user.id,
            'Chưa nhập môn, hãy gõ thamgia trước!'
          );
          return;
        }

        const result = await this.playerService.changeGender(
          tenantId,
          player.id,
          cmd.gender!
        );
        if (!result.success) {
          await this.emitCommandRejected(
            tenantId,
            sessionId,
            player.id,
            'Đổi giới tính cần cách nhau 24 giờ!'
          );
        }
        break;
      }

      case 'breakthrough': {
        await this.handleBreakthroughCommand(tenantId, sessionId, user, config);
        break;
      }

      case 'info':
      case 'cultivation':
      case 'realm': {
        await this.handleProfileCommand(tenantId, sessionId, user, cmd);
        break;
      }

      case 'leaderboard':
      case 'top': {
        await this.handleLeaderboardCommand(tenantId, sessionId);
        break;
      }
    }
  }

  /**
   * Handles `dokiep` chat command per GDD §7.1.
   */
  private async handleBreakthroughCommand(
    tenantId: string,
    sessionId: string,
    user: any,
    config: any
  ): Promise<void> {
    const player = await this.playerService.getPlayerByUserId(tenantId, user.id);
    if (!player) {
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        user.id,
        'Chưa nhập môn, hãy gõ thamgia trước!'
      );
      return;
    }

    const levelTable = await this.configService.getLevelTable(tenantId);

    // 1. Check max realm
    if (player.realmOrder >= 8) {
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        player.id,
        'Đã đạt cảnh giới tối cao (Đại Thừa), không thể độ kiếp tiếp!'
      );
      return;
    }

    // 2. Check level 10 and Đại Viên Mãn
    if (player.level < 10 || !isMaxLevel(player, levelTable)) {
      const req10 = levelTable.required(player.realmOrder, 10);
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        player.id,
        `Chưa viên mãn: ${player.currentExp}/${req10} tu vi!`
      );
      return;
    }

    // 3. Check cooldown
    if (player.breakthroughCooldownUntil && player.breakthroughCooldownUntil > new Date()) {
      const remainingSec = Math.ceil(
        (player.breakthroughCooldownUntil.getTime() - Date.now()) / 1000
      );
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        player.id,
        `Đang tĩnh dưỡng kinh mạch: còn ${remainingSec} giây!`
      );
      return;
    }

    // 4. Check active breakthrough session
    const existingSession = await this.prisma.breakthroughSession.findFirst({
      where: {
        tenantId,
        playerId: player.id,
        status: { in: ['preparing', 'resolving'] },
      },
    });

    if (existingSession) {
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        player.id,
        'Ngươi đang trong quá trình độ kiếp!'
      );
      return;
    }

    // 5. Check concurrent room limit (GDD §7.1: maxConcurrentBreakthroughs)
    const maxConcurrent = config.values.maxConcurrentBreakthroughs || 3;
    const activeCount = await this.prisma.breakthroughSession.count({
      where: {
        tenantId,
        status: { in: ['preparing', 'resolving'] },
      },
    });

    if (activeCount >= maxConcurrent) {
      await this.emitCommandRejected(
        tenantId,
        sessionId,
        player.id,
        'Thiên kiếp đang dồn dập, hãy đợi các đạo hữu khác hoàn tất!'
      );
      return;
    }

    // 6. Create preparing session
    const realms = await this.configService.getRealms(tenantId);
    const realm = realms.find((r) => r.realmOrder === player.realmOrder);
    const baseChanceBp = realm?.baseChanceBp ?? 9000;
    const maxChanceBp = config.values.maxChanceBp ?? 9500;
    const prepSeconds = config.values.preparationSeconds || 30;
    const now = new Date();
    const endsAt = new Date(now.getTime() + prepSeconds * 1000);

    const session = await this.prisma.breakthroughSession.create({
      data: {
        tenantId,
        playerId: player.id,
        liveSessionId: sessionId,
        sourceRealmOrder: player.realmOrder,
        targetRealmOrder: player.realmOrder + 1,
        baseChanceBp,
        maxChanceBp,
        bonusDiamonds: 0n,
        giftBonusBp: 0,
        finalChanceBp: baseChanceBp,
        status: 'preparing',
        trigger: 'chat',
        startedAt: now,
        endsAt,
        configSnapshot: {
          baseChanceBp,
          maxChanceBp,
          preparationSeconds: prepSeconds,
        },
      },
    });

    const gameEvent = await this.prisma.gameEvent.create({
      data: {
        tenantId,
        liveSessionId: sessionId,
        playerId: player.id,
        eventType: 'breakthrough_started',
        payload: {
          breakthroughId: session.id,
          playerId: player.id,
          username: player.username,
          sourceRealmOrder: session.sourceRealmOrder,
          targetRealmOrder: session.targetRealmOrder,
          baseChanceBp: session.baseChanceBp,
          endsAt: session.endsAt.toISOString(),
          seconds: prepSeconds,
        },
      },
    });

    if (this.realtimeGateway) {
      this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, gameEvent);
    }
  }

  private async handleProfileCommand(
    tenantId: string,
    sessionId: string,
    user: any,
    cmd: GameCommand
  ): Promise<void> {
    const profile = await this.playerService.getPlayerProfile(tenantId, user.id);
    if (!profile) return;

    if (this.realtimeGateway) {
      this.realtimeGateway.broadcastFrame(tenantId, sessionId, {
        type: 'game',
        event: 'command.reply',
        seq: '0',
        sessionId,
        at: new Date().toISOString(),
        data: {
          playerId: profile.id,
          command: cmd.type,
          card: {
            username: profile.username,
            realmName: profile.realmName,
            level: profile.level,
            currentExp: profile.currentExp.toString(),
            requiredExp: profile.requiredExp.toString(),
            totalCultivation: profile.totalCultivation.toString(),
          },
        },
      });
    }
  }

  private async handleLeaderboardCommand(
    tenantId: string,
    sessionId: string
  ): Promise<void> {
    if (this.realtimeGateway) {
      this.realtimeGateway.broadcastFrame(tenantId, sessionId, {
        type: 'game',
        event: 'leaderboard.updated',
        seq: '0',
        sessionId,
        at: new Date().toISOString(),
        data: {
          board: 'cultivation',
          action: 'expand_overlay',
        },
      });
    }
  }

  private async emitCommandRejected(
    tenantId: string,
    sessionId: string,
    playerId: string,
    reason: string
  ): Promise<void> {
    const gameEvent = await this.prisma.gameEvent.create({
      data: {
        tenantId,
        liveSessionId: sessionId,
        playerId,
        eventType: 'command_rejected',
        payload: {
          playerId,
          reason,
        },
      },
    });

    if (this.realtimeGateway) {
      this.realtimeGateway.broadcastFromGameEvent(tenantId, sessionId, gameEvent);
    }
  }

  /**
   * Diagnostic metrics for health monitoring.
   */
  public getMetrics(): ProcessorMetrics {
    return {
      queueSize: this.totalQueueSize,
      activeTasks: this.activeTasksCount,
      processorLagMs: this.latestLagMs,
      isBackpressureActive: this.totalQueueSize > 5000,
      totalProcessed: this.totalProcessedCount,
      droppedCommands: this.droppedCommandsCount,
    };
  }
}
