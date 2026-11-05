import { GameFrame } from '../../websocket/types';
import { GameEvent } from '@prisma/client';

export interface GameGatewayBroadcaster {
  broadcastGameFrame?(tenantId: string, sessionId: string, frame: GameFrame): void;
  connections?: Map<any, any>;
}

/**
 * GameRealtimeGateway - Broadcasts game.* frames over WebSocket to subscribed clients.
 * References:
 * - docs/game/05_Architecture.md §6
 */
export class GameRealtimeGateway {
  private readonly leaderboardThrottleMap = new Map<
    string,
    {
      lastSent: number;
      timer: NodeJS.Timeout | null;
      lastPayload: any;
    }
  >();

  constructor(private readonly wsManager?: GameGatewayBroadcaster) {}

  /**
   * Directly sends a prepared GameFrame to authorized subscribers.
   */
  public broadcastFrame(tenantId: string, sessionId: string, frame: GameFrame): void {
    if (!tenantId || !sessionId || !frame) return;

    if (this.wsManager && typeof this.wsManager.broadcastGameFrame === 'function') {
      this.wsManager.broadcastGameFrame(tenantId, sessionId, frame);
      return;
    }

    const connections = this.wsManager?.connections;
    if (connections && typeof connections.entries === 'function') {
      const messageString = JSON.stringify(frame);
      for (const [socket, state] of connections.entries()) {
        if (
          state?.authenticated &&
          state?.tenantId === tenantId &&
          state?.subscribedSessionIds?.has(sessionId) &&
          socket?.readyState === 1 /* WebSocket.OPEN */
        ) {
          try {
            socket.send(messageString);
          } catch {
            // ignore transient socket send error
          }
        }
      }
    }
  }

  /**
   * Broadcasts a game event recorded in PostgreSQL after the transaction commits.
   */
  public broadcastFromGameEvent(
    tenantId: string,
    sessionId: string,
    event: GameEvent
  ): void {
    const frameName = this.mapEventTypeToFrameName(event.eventType);
    const frame: GameFrame = {
      type: 'game',
      event: frameName,
      seq: event.seq.toString(),
      sessionId,
      at: event.createdAt.toISOString(),
      data: event.payload as any,
    };

    if (frameName === 'leaderboard.updated') {
      const board = (event.payload as any)?.board || 'default';
      this.broadcastThrottledLeaderboard(tenantId, sessionId, board, frame);
    } else {
      this.broadcastFrame(tenantId, sessionId, frame);
    }
  }

  /**
   * Maps internal GameEventType enum to the WebSocket frame event string per 05_Architecture.md §6.
   */
  public mapEventTypeToFrameName(eventType: string): string {
    switch (eventType) {
      case 'player_joined':
        return 'player.joined';
      case 'player_returned':
        return 'player.returned';
      case 'exp_gained':
        return 'exp.gained';
      case 'level_up':
        return 'level.up';
      case 'max_level_reached':
        return 'level.max';
      case 'breakthrough_started':
        return 'breakthrough.started';
      case 'breakthrough_bonus':
        return 'breakthrough.bonus';
      case 'breakthrough_succeeded':
      case 'breakthrough_failed':
        return 'breakthrough.resolved';
      case 'breakthrough_cancelled':
        return 'breakthrough.cancelled';
      case 'command_rejected':
        return 'command.rejected';
      case 'config_changed':
        return 'config.changed';
      default:
        return eventType.replace(/_/g, '.');
    }
  }

  /**
   * Throttles leaderboard.updated frame broadcast to at most once every 2 seconds per board.
   */
  public broadcastThrottledLeaderboard(
    tenantId: string,
    sessionId: string,
    board: string,
    frame: GameFrame
  ): void {
    const key = `${tenantId}:${sessionId}:${board}`;
    const now = Date.now();
    const entry = this.leaderboardThrottleMap.get(key) || {
      lastSent: 0,
      timer: null,
      lastPayload: null,
    };

    entry.lastPayload = frame;

    const elapsed = now - entry.lastSent;
    const throttleLimitMs = 2000;

    if (elapsed >= throttleLimitMs) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.lastSent = now;
      this.leaderboardThrottleMap.set(key, entry);
      this.broadcastFrame(tenantId, sessionId, frame);
    } else if (!entry.timer) {
      const delay = throttleLimitMs - elapsed;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        entry.lastSent = Date.now();
        if (entry.lastPayload) {
          this.broadcastFrame(tenantId, sessionId, entry.lastPayload);
        }
      }, delay);
      this.leaderboardThrottleMap.set(key, entry);
    }
  }

  /**
   * Cleans up pending throttle timers.
   */
  public destroy(): void {
    for (const entry of this.leaderboardThrottleMap.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.leaderboardThrottleMap.clear();
  }
}
