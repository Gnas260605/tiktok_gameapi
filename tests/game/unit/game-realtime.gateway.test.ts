import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameRealtimeGateway } from '../../../src/services/game/game-realtime.gateway';
import { GameEvent } from '@prisma/client';

describe('GameRealtimeGateway — Unit Tests (Lát 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps internal GameEventType to WebSocket frame event names conforming to Architecture §6', () => {
    const gateway = new GameRealtimeGateway();

    expect(gateway.mapEventTypeToFrameName('player_joined')).toBe('player.joined');
    expect(gateway.mapEventTypeToFrameName('player_returned')).toBe('player.returned');
    expect(gateway.mapEventTypeToFrameName('exp_gained')).toBe('exp.gained');
    expect(gateway.mapEventTypeToFrameName('level_up')).toBe('level.up');
    expect(gateway.mapEventTypeToFrameName('max_level_reached')).toBe('level.max');
    expect(gateway.mapEventTypeToFrameName('breakthrough_started')).toBe('breakthrough.started');
    expect(gateway.mapEventTypeToFrameName('breakthrough_bonus')).toBe('breakthrough.bonus');
    expect(gateway.mapEventTypeToFrameName('breakthrough_succeeded')).toBe('breakthrough.resolved');
    expect(gateway.mapEventTypeToFrameName('breakthrough_failed')).toBe('breakthrough.resolved');
    expect(gateway.mapEventTypeToFrameName('breakthrough_cancelled')).toBe('breakthrough.cancelled');
    expect(gateway.mapEventTypeToFrameName('command_rejected')).toBe('command.rejected');
    expect(gateway.mapEventTypeToFrameName('config_changed')).toBe('config.changed');
  });

  it('broadcasts frame with seq formatted as string and correct payload', () => {
    const sentFrames: any[] = [];
    const mockWsManager = {
      broadcastGameFrame: vi.fn((tenantId, sessionId, frame) => {
        sentFrames.push({ tenantId, sessionId, frame });
      }),
    };

    const gateway = new GameRealtimeGateway(mockWsManager);

    const mockGameEvent: GameEvent = {
      id: 'ge_1',
      seq: 1234567890123456789n,
      tenantId: 'tenant_test',
      liveSessionId: 'session_test',
      playerId: 'player_test',
      eventType: 'exp_gained',
      payload: { amount: '100', giftName: 'Rose' },
      createdAt: new Date('2026-11-05T12:00:00.000Z'),
    };

    gateway.broadcastFromGameEvent('tenant_test', 'session_test', mockGameEvent);

    expect(mockWsManager.broadcastGameFrame).toHaveBeenCalledTimes(1);
    expect(sentFrames).toHaveLength(1);

    const { tenantId, sessionId, frame } = sentFrames[0];
    expect(tenantId).toBe('tenant_test');
    expect(sessionId).toBe('session_test');
    expect(frame.type).toBe('game');
    expect(frame.event).toBe('exp.gained');
    expect(frame.seq).toBe('1234567890123456789'); // string monotonic sequence
    expect(frame.sessionId).toBe('session_test');
    expect(frame.at).toBe('2026-11-05T12:00:00.000Z');
    expect(frame.data).toEqual({ amount: '100', giftName: 'Rose' });
  });

  it('throttles leaderboard.updated frames to at most once per 2 seconds per board', () => {
    const sentFrames: any[] = [];
    const mockWsManager = {
      broadcastGameFrame: vi.fn((_tenantId, _sessionId, frame) => {
        sentFrames.push(frame);
      }),
    };

    const gateway = new GameRealtimeGateway(mockWsManager);
    const tenantId = 't1';
    const sessionId = 's1';

    // 1st update -> sent immediately
    gateway.broadcastThrottledLeaderboard(tenantId, sessionId, 'cultivation', {
      type: 'game',
      event: 'leaderboard.updated',
      seq: '1',
      sessionId,
      at: new Date().toISOString(),
      data: { board: 'cultivation', entries: [{ rank: 1, name: 'Player A' }] },
    });
    expect(sentFrames).toHaveLength(1);
    expect(sentFrames[0].data.entries[0].name).toBe('Player A');

    // 2nd update at 500ms -> throttled
    vi.advanceTimersByTime(500);
    gateway.broadcastThrottledLeaderboard(tenantId, sessionId, 'cultivation', {
      type: 'game',
      event: 'leaderboard.updated',
      seq: '2',
      sessionId,
      at: new Date().toISOString(),
      data: { board: 'cultivation', entries: [{ rank: 1, name: 'Player B' }] },
    });
    expect(sentFrames).toHaveLength(1); // not sent yet

    // 3rd update at 1000ms -> updates trailing payload
    vi.advanceTimersByTime(500);
    gateway.broadcastThrottledLeaderboard(tenantId, sessionId, 'cultivation', {
      type: 'game',
      event: 'leaderboard.updated',
      seq: '3',
      sessionId,
      at: new Date().toISOString(),
      data: { board: 'cultivation', entries: [{ rank: 1, name: 'Player C' }] },
    });
    expect(sentFrames).toHaveLength(1); // still waiting

    // Advance to 2000ms -> trailing timer fires with latest payload (Player C)
    vi.advanceTimersByTime(1000);
    expect(sentFrames).toHaveLength(2);
    expect(sentFrames[1].data.entries[0].name).toBe('Player C');

    gateway.destroy();
  });

  it('broadcasts across direct WebSocketManager connections if broadcastGameFrame is not present', () => {
    const mockSocket = {
      readyState: 1,
      send: vi.fn(),
    };
    const mockState = {
      authenticated: true,
      tenantId: 'tenant_direct',
      subscribedSessionIds: new Set(['session_direct']),
    };

    const connectionsMap = new Map();
    connectionsMap.set(mockSocket, mockState);

    const gateway = new GameRealtimeGateway({ connections: connectionsMap });

    gateway.broadcastFrame('tenant_direct', 'session_direct', {
      type: 'game',
      event: 'player.joined',
      seq: '10',
      sessionId: 'session_direct',
      at: '2026-11-05T00:00:00Z',
      data: { username: 'test_user' },
    });

    expect(mockSocket.send).toHaveBeenCalledTimes(1);
    const sentJson = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(sentJson.type).toBe('game');
    expect(sentJson.event).toBe('player.joined');
  });
});
