import { describe, it, expect, vi } from 'vitest';
import { GameEventBus } from '../../../src/services/game/game-event-bus';
import { EventIngestionService } from '../../../src/services/event/event-ingestion.service';
import { UserNormalizationService } from '../../../src/services/user/user-normalization.service';

describe('GameEventBus & EventIngestionService Hook (Lát 3)', () => {
  it('publishes events to subscribers safely', async () => {
    const bus = new GameEventBus();
    const received: any[] = [];
    const typedReceived: any[] = [];

    const unsubGeneral = bus.subscribe((payload) => {
      received.push(payload);
    });

    const unsubTyped = bus.subscribeToType('gift', (payload) => {
      typedReceived.push(payload);
    });

    const testEvent = { id: 'evt_1', eventType: 'gift', data: { giftId: 'rose' } };
    const testUser = { id: 'usr_1', uniqueId: 'player_one' };

    bus.publish('tenant_a', 'session_1', testEvent, testUser);

    expect(received).toHaveLength(1);
    expect(received[0].tenantId).toBe('tenant_a');
    expect(received[0].sessionId).toBe('session_1');
    expect(received[0].event).toEqual(testEvent);
    expect(received[0].user).toEqual(testUser);

    expect(typedReceived).toHaveLength(1);
    expect(typedReceived[0].event.eventType).toBe('gift');

    // Unsubscribe works
    unsubGeneral();
    unsubTyped();

    bus.publish('tenant_a', 'session_1', testEvent, testUser);
    expect(received).toHaveLength(1);
    expect(typedReceived).toHaveLength(1);
  });

  it('handles exceptions thrown in listeners without crashing publish', () => {
    const bus = new GameEventBus();
    bus.subscribe(() => {
      throw new Error('Listener crashed unexpectedly');
    });

    expect(() => {
      bus.publish('tenant_a', 'session_1', { id: 'evt_1', eventType: 'chat' }, { id: 'usr_1' });
    }).not.toThrow();
  });

  it('forwards persisted events to GameEventBus from EventIngestionService', async () => {
    const bus = new GameEventBus();
    const publishSpy = vi.spyOn(bus, 'publish');

    const mockSessionRepo: any = {
      findById: vi.fn().mockResolvedValue({ id: 's1', tenantId: 't1' }),
      updateStatistics: vi.fn().mockResolvedValue({}),
    };
    const mockUserRepo: any = {
      upsertUser: vi.fn().mockResolvedValue({ id: 'u1', uniqueId: 'streamer' }),
    };
    const mockEventRepo: any = {
      createEvent: vi.fn().mockResolvedValue({
        id: 'e1',
        tenantId: 't1',
        sessionId: 's1',
        eventType: 'gift',
        sourceEventId: 'msg_99',
        data: { diamondCount: 10 },
      }),
    };
    const userNorm = new UserNormalizationService();

    const service = new EventIngestionService(
      mockSessionRepo,
      mockUserRepo,
      mockEventRepo,
      userNorm,
      undefined,
      {},
      bus
    );

    const canonicalEvent: any = {
      id: 'msg_99',
      eventType: 'gift',
      eventTimestamp: new Date(),
      user: { uniqueId: 'streamer' },
      payload: { diamondCount: 10 },
    };

    await service.ingestEvent(canonicalEvent, { tenantId: 't1', sessionId: 's1' });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [tenantId, sessionId, persistedEvent, persistedUser] = publishSpy.mock.calls[0];
    expect(tenantId).toBe('t1');
    expect(sessionId).toBe('s1');
    expect(persistedEvent.id).toBe('e1');
    expect(persistedUser.id).toBe('u1');
  });

  it('isolates ingestion pipeline when GameEventBus throws', async () => {
    const failingBus: any = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('Bus is down');
      }),
    };

    const mockSessionRepo: any = {
      findById: vi.fn().mockResolvedValue({ id: 's1', tenantId: 't1' }),
      updateStatistics: vi.fn().mockResolvedValue({}),
    };
    const mockUserRepo: any = {
      upsertUser: vi.fn().mockResolvedValue({ id: 'u1', uniqueId: 'streamer' }),
    };
    const mockEventRepo: any = {
      createEvent: vi.fn().mockResolvedValue({
        id: 'e1',
        tenantId: 't1',
        sessionId: 's1',
        eventType: 'gift',
      }),
    };
    const userNorm = new UserNormalizationService();

    const service = new EventIngestionService(
      mockSessionRepo,
      mockUserRepo,
      mockEventRepo,
      userNorm,
      undefined,
      {},
      failingBus
    );

    const canonicalEvent: any = {
      id: 'msg_100',
      eventType: 'gift',
      eventTimestamp: new Date(),
      user: { uniqueId: 'streamer' },
      payload: {},
    };

    // Even if bus throws, ingestion succeeds
    const result = await service.ingestEvent(canonicalEvent, { tenantId: 't1', sessionId: 's1' });
    expect(result).toBeDefined();
    expect(result.id).toBe('e1');
  });
});
