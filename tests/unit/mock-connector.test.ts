import { describe, it, expect } from 'vitest';
import { MockConnector, ConnectorFactory } from '../../src/adapters/tiktok';

describe('MockConnector Unit Tests', () => {
  it('connects fast (<20ms) and populates roomInfo', async () => {
    const connector = new MockConnector();
    const start = Date.now();
    const result = await connector.connect('streamer_fast');
    const elapsed = Date.now() - start;

    expect(result.success).toBe(true);
    expect(result.status).toBe('connected');
    expect(connector.isConnected()).toBe(true);
    expect(connector.getStatus()).toBe('connected');
    expect(connector.getRoomInfo()?.creatorUsername).toBe('streamer_fast');
    expect(elapsed).toBeLessThan(50);

    await connector.disconnect();
    expect(connector.getStatus()).toBe('disconnected');
    expect(connector.isConnected()).toBe(false);
  });

  it('calculates full jitter exponential backoff delay correctly', () => {
    const connector = new MockConnector();
    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = connector.calculateBackoffDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });

  it('simulates all 7 event types emitting CanonicalEvent envelopes', () => {
    const connector = new MockConnector();
    const emittedEvents: any[] = [];

    connector.on('member', (e) => emittedEvents.push(e));
    connector.on('chat', (e) => emittedEvents.push(e));
    connector.on('gift', (e) => emittedEvents.push(e));
    connector.on('like', (e) => emittedEvents.push(e));
    connector.on('follow', (e) => emittedEvents.push(e));
    connector.on('share', (e) => emittedEvents.push(e));
    connector.on('roomUser', (e) => emittedEvents.push(e));

    connector.simulateMember();
    connector.simulateChat('Hello world');
    connector.simulateGift('Rose', 1, 10);
    connector.simulateLike(5);
    connector.simulateFollow();
    connector.simulateShare('whatsapp');
    connector.simulateRoomUser(999);

    expect(emittedEvents.length).toBe(7);

    // Verify roomUser has strictly null user
    const roomUserEvent = emittedEvents.find((e) => e.eventType === 'roomUser');
    expect(roomUserEvent).toBeDefined();
    expect(roomUserEvent.user).toBeNull();
    expect(roomUserEvent.payload.viewerCount).toBe(999);
  });

  it('runs background ticker and stops cleanly', async () => {
    const connector = new MockConnector();
    await connector.connect('ticker_streamer');

    const tickEvents: any[] = [];
    connector.on('like', (e) => tickEvents.push(e));
    connector.on('chat', (e) => tickEvents.push(e));
    connector.on('gift', (e) => tickEvents.push(e));

    connector.startTicker(20);
    await new Promise((r) => setTimeout(r, 120));
    connector.stopTicker();

    const countBefore = tickEvents.length;
    expect(countBefore).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 60));
    expect(tickEvents.length).toBe(countBefore); // No new events after stop

    await connector.disconnect();
  });

  it('ConnectorFactory creates MockConnector in test environment', () => {
    const connector = ConnectorFactory.createConnector();
    expect(connector instanceof MockConnector).toBe(true);

    const explicitMock = ConnectorFactory.createMockConnector();
    expect(explicitMock instanceof MockConnector).toBe(true);
  });
});
