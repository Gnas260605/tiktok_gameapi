import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';
import { WebSocket } from 'ws';
import { RealtimeTicketService } from '../../src/services/realtime/ticket.service';
import { WebSocketManager } from '../../src/websocket/websocket-manager';

// Mock WebSocket class simulating ws.WebSocket
class MockSocket extends EventEmitter {
  public readyState: number = WebSocket.OPEN;
  public sentMessages: any[] = [];
  public closedWith: { code?: number; reason?: string } = {};

  public send(data: string): void {
    this.sentMessages.push(JSON.parse(data));
  }

  public close(code?: number, reason?: string): void {
    this.readyState = WebSocket.CLOSED;
    this.closedWith = { code, reason };
    this.emit('close', code, reason);
  }
}

describe('WebSocketManager Protocol & Tenant Isolation', () => {
  let ticketService: RealtimeTicketService;
  let wsManager: WebSocketManager;

  beforeEach(() => {
    ticketService = new RealtimeTicketService(60);
    wsManager = new WebSocketManager(ticketService, {
      authTimeoutMs: 1000,
      heartbeatIntervalMs: 5000,
      idleTimeoutMs: 10000,
      maxConnectionsPerTenant: 2,
      maxSubscriptionsPerSocket: 5,
    });
  });

  afterEach(() => {
    wsManager.destroy();
    ticketService.destroy();
  });

  it('authenticates client successfully with a valid ticket', () => {
    const socket = new MockSocket() as unknown as WebSocket;
    wsManager.handleConnection(socket);

    const ticket = ticketService.createTicket('tenant-alpha', ['sess-1', 'sess-2']);
    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'authenticate',
      ticket: ticket.ticket,
    })));

    const sent = (socket as any).sentMessages;
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('authenticated');
    expect(sent[0].connectionId).toBeDefined();
  });

  it('rejects authentication with invalid or expired ticket', () => {
    const socket = new MockSocket() as unknown as WebSocket;
    wsManager.handleConnection(socket);

    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'authenticate',
      ticket: 'tkt_invalid_token',
    })));

    const sent = (socket as any).sentMessages;
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('error');
    expect(sent[0].error.code).toBe('INVALID_TICKET');
    expect((socket as any).closedWith.code).toBe(1008);
  });

  it('subscribes to authorized sessions and rejects unauthorized sessions', () => {
    const socket = new MockSocket() as unknown as WebSocket;
    wsManager.handleConnection(socket);

    const ticket = ticketService.createTicket('tenant-alpha', ['sess-1']);
    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'authenticate',
      ticket: ticket.ticket,
    })));

    // Subscribe to authorized session
    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'subscribe',
      sessionId: 'sess-1',
    })));

    // Subscribe to unauthorized session
    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'subscribe',
      sessionId: 'sess-unauthorized',
    })));

    const sent = (socket as any).sentMessages;
    expect(sent[1]).toEqual({ type: 'subscribed', sessionId: 'sess-1' });
    expect(sent[2].type).toBe('error');
    expect(sent[2].error.code).toBe('SESSION_FORBIDDEN');
  });

  it('strictly enforces tenant isolation during live broadcast', () => {
    const socketAlpha = new MockSocket() as unknown as WebSocket;
    const socketBeta = new MockSocket() as unknown as WebSocket;

    wsManager.handleConnection(socketAlpha);
    wsManager.handleConnection(socketBeta);

    const ticketAlpha = ticketService.createTicket('tenant-alpha', ['common-session']);
    const ticketBeta = ticketService.createTicket('tenant-beta', ['common-session']);

    (socketAlpha as any).emit('message', Buffer.from(JSON.stringify({
      action: 'authenticate',
      ticket: ticketAlpha.ticket,
    })));
    (socketAlpha as any).emit('message', Buffer.from(JSON.stringify({
      action: 'subscribe',
      sessionId: 'common-session',
    })));

    (socketBeta as any).emit('message', Buffer.from(JSON.stringify({
      action: 'authenticate',
      ticket: ticketBeta.ticket,
    })));
    (socketBeta as any).emit('message', Buffer.from(JSON.stringify({
      action: 'subscribe',
      sessionId: 'common-session',
    })));

    // Broadcast event strictly for tenant-alpha
    wsManager.broadcast('tenant-alpha', 'common-session', {
      id: 'event-001',
      type: 'chat',
      occurredAt: new Date(),
      receivedAt: new Date(),
      data: { text: 'Hello Alpha' },
    });

    const alphaMessages = (socketAlpha as any).sentMessages;
    const betaMessages = (socketBeta as any).sentMessages;

    // socketAlpha receives authenticated, subscribed, and event
    expect(alphaMessages.some((m: any) => m.type === 'event' && m.event.data.text === 'Hello Alpha')).toBe(true);

    // socketBeta NEVER receives the event of tenant-alpha
    expect(betaMessages.some((m: any) => m.type === 'event')).toBe(false);
  });

  it('handles ping and pong with server time', () => {
    const socket = new MockSocket() as unknown as WebSocket;
    wsManager.handleConnection(socket);

    (socket as any).emit('message', Buffer.from(JSON.stringify({
      action: 'ping',
      clientTime: new Date().toISOString(),
    })));

    const sent = (socket as any).sentMessages;
    expect(sent.length).toBe(1);
    expect(sent[0].type).toBe('pong');
    expect(sent[0].serverTime).toBeDefined();
  });
});
