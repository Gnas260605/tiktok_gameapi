import crypto from 'crypto';

export interface TicketData {
  ticket: string;
  tenantId: string;
  sessionIds: string[];
  expiresAt: Date;
}

export interface TicketIssueResult {
  ticket: string;
  expiresAt: string;
  websocketUrl: string;
}

export class RealtimeTicketService {
  private readonly tickets = new Map<string, TicketData>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(private readonly defaultTtlSeconds: number = 60) {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 30000);
  }

  /**
   * Generates a single-use cryptographically random ticket bound to tenant and sessions.
   */
  public createTicket(
    tenantId: string,
    sessionIds: string[],
    ttlSeconds?: number,
    wsBaseUrl = 'ws://localhost:3000/ws'
  ): TicketIssueResult {
    if (!tenantId) {
      throw new Error('Tenant ID is required to create a realtime ticket');
    }

    if (!sessionIds || sessionIds.length === 0) {
      throw new Error('At least one sessionId is required to create a realtime ticket');
    }

    const ttl = (ttlSeconds && ttlSeconds > 0) ? ttlSeconds : this.defaultTtlSeconds;
    const ticketToken = `tkt_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + ttl * 1000);

    this.tickets.set(ticketToken, {
      ticket: ticketToken,
      tenantId,
      sessionIds: [...sessionIds],
      expiresAt,
    });

    return {
      ticket: ticketToken,
      expiresAt: expiresAt.toISOString(),
      websocketUrl: wsBaseUrl,
    };
  }

  /**
   * Atomically validates and redeems a ticket.
   * Single-use: once redeemed or if expired, it is purged immediately.
   */
  public redeemTicket(ticketToken: string): { tenantId: string; sessionIds: string[] } | null {
    if (!ticketToken || typeof ticketToken !== 'string') {
      return null;
    }

    const data = this.tickets.get(ticketToken);
    if (!data) {
      return null;
    }

    // Always remove from store immediately to enforce single-use semantics
    this.tickets.delete(ticketToken);

    // Check expiration
    if (data.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    return {
      tenantId: data.tenantId,
      sessionIds: data.sessionIds,
    };
  }

  /**
   * Sweep out expired tickets to prevent memory leakage.
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [token, data] of this.tickets.entries()) {
      if (data.expiresAt.getTime() <= now) {
        this.tickets.delete(token);
      }
    }
  }

  /**
   * Cleanup timer resources.
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.tickets.clear();
  }
}
