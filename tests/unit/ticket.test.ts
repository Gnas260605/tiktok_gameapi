import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeTicketService } from '../../src/services/realtime/ticket.service';

describe('RealtimeTicketService', () => {
  let ticketService: RealtimeTicketService;

  beforeEach(() => {
    ticketService = new RealtimeTicketService(60);
  });

  afterEach(() => {
    ticketService.destroy();
  });

  it('creates a valid ticket with expiration and websocket URL', () => {
    const tenantId = 't-1234';
    const sessionIds = ['sess-1', 'sess-2'];
    const result = ticketService.createTicket(tenantId, sessionIds, 60, 'ws://localhost:3000/ws');

    expect(result.ticket).toMatch(/^tkt_[0-9a-f]{48}$/);
    expect(result.websocketUrl).toBe('ws://localhost:3000/ws');
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('redeems a ticket once (single-use semantics)', () => {
    const tenantId = 't-1234';
    const sessionIds = ['sess-1'];
    const result = ticketService.createTicket(tenantId, sessionIds);

    // First redemption succeeds
    const redeemed = ticketService.redeemTicket(result.ticket);
    expect(redeemed).not.toBeNull();
    expect(redeemed?.tenantId).toBe(tenantId);
    expect(redeemed?.sessionIds).toEqual(sessionIds);

    // Second redemption fails (already consumed)
    const secondRedeem = ticketService.redeemTicket(result.ticket);
    expect(secondRedeem).toBeNull();
  });

  it('rejects expired tickets', () => {
    vi.useFakeTimers();
    try {
      const tenantId = 't-1234';
      const sessionIds = ['sess-1'];
      const result = ticketService.createTicket(tenantId, sessionIds, 1); // 1 second TTL

      // Advance clock by 2 seconds
      vi.advanceTimersByTime(2000);

      const redeemed = ticketService.redeemTicket(result.ticket);
      expect(redeemed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid inputs on creation', () => {
    expect(() => ticketService.createTicket('', ['s1'])).toThrow();
    expect(() => ticketService.createTicket('t1', [])).toThrow();
  });
});
