import { WebSocket, RawData } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { RealtimeTicketService } from '../services/realtime/ticket.service';
import {
  ClientConnectionState,
  ClientMessage,
  ServerMessage,
  WebSocketManagerOptions,
} from './types';

export class WebSocketManager {
  private readonly connections = new Map<WebSocket, ClientConnectionState>();
  private readonly options: Required<WebSocketManagerOptions>;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly ticketService: RealtimeTicketService,
    options: WebSocketManagerOptions = {}
  ) {
    this.options = {
      authTimeoutMs: options.authTimeoutMs ?? 5000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30000,
      idleTimeoutMs: options.idleTimeoutMs ?? 60000,
      maxConnectionsPerTenant: options.maxConnectionsPerTenant ?? 50,
      maxSubscriptionsPerSocket: options.maxSubscriptionsPerSocket ?? 20,
      maxMessageSize: options.maxMessageSize ?? 65536,
    };

    this.heartbeatInterval = setInterval(() => {
      this.heartbeatSweep();
    }, this.options.heartbeatIntervalMs);
  }

  /**
   * Registers a new raw WebSocket connection and initializes authentication timeout.
   */
  public handleConnection(socket: WebSocket): void {
    const connectionId = uuidv4();
    const state: ClientConnectionState = {
      connectionId,
      socket,
      tenantId: null,
      authenticated: false,
      authorizedSessionIds: new Set<string>(),
      subscribedSessionIds: new Set<string>(),
      connectedAt: new Date(),
      lastPingAt: Date.now(),
      authTimeoutTimer: null,
    };

    // Arm authentication timeout
    state.authTimeoutTimer = setTimeout(() => {
      if (!state.authenticated) {
        this.sendError(socket, 'AUTHENTICATION_TIMEOUT', 'Authentication timeout expired');
        try {
          socket.close(1008, 'Authentication timeout');
        } catch {
          // ignore
        }
        this.cleanupConnection(socket);
      }
    }, this.options.authTimeoutMs);

    this.connections.set(socket, state);

    socket.on('message', (raw: RawData) => {
      this.handleMessage(socket, raw);
    });

    socket.on('close', () => {
      this.cleanupConnection(socket);
    });

    socket.on('error', () => {
      this.cleanupConnection(socket);
    });
  }

  /**
   * Dispatches inbound client messages.
   */
  private handleMessage(socket: WebSocket, raw: RawData): void {
    const state = this.connections.get(socket);
    if (!state) return;

    if (Buffer.byteLength(raw as any) > this.options.maxMessageSize) {
      this.sendError(socket, 'MESSAGE_TOO_LARGE', 'Inbound message exceeds maximum size of 64KB');
      socket.close(1008, 'Message too large');
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      this.sendError(socket, 'BAD_REQUEST', 'Invalid JSON message payload');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.action) {
      this.sendError(socket, 'BAD_REQUEST', 'Message must contain an action property');
      return;
    }

    const msg = parsed as ClientMessage;

    switch (msg.action) {
      case 'authenticate':
        this.handleAuthenticate(socket, state, msg);
        break;

      case 'subscribe':
        this.handleSubscribe(socket, state, msg);
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(socket, state, msg);
        break;

      case 'ping':
        this.handlePing(socket, state, msg);
        break;

      default:
        this.sendError(socket, 'UNKNOWN_ACTION', `Unknown action: ${(msg as any).action}`);
        break;
    }
  }

  private handleAuthenticate(
    socket: WebSocket,
    state: ClientConnectionState,
    msg: { action: 'authenticate'; ticket: string }
  ): void {
    if (state.authenticated) {
      this.sendError(socket, 'ALREADY_AUTHENTICATED', 'Connection is already authenticated');
      return;
    }

    if (!msg.ticket || typeof msg.ticket !== 'string') {
      this.sendError(socket, 'INVALID_TICKET', 'A valid ticket string is required');
      socket.close(1008, 'Invalid ticket');
      return;
    }

    const ticketData = this.ticketService.redeemTicket(msg.ticket);
    if (!ticketData) {
      this.sendError(socket, 'INVALID_TICKET', 'The provided ticket is invalid or has expired');
      socket.close(1008, 'Invalid ticket');
      return;
    }

    // Check tenant socket concurrency limit
    const tenantConnections = this.countTenantConnections(ticketData.tenantId);
    if (tenantConnections >= this.options.maxConnectionsPerTenant) {
      this.sendError(
        socket,
        'TENANT_LIMIT_EXCEEDED',
        `Maximum concurrent connections (${this.options.maxConnectionsPerTenant}) reached for tenant`
      );
      socket.close(1013, 'Tenant connection limit reached');
      return;
    }

    // Authenticate client
    if (state.authTimeoutTimer) {
      clearTimeout(state.authTimeoutTimer);
      state.authTimeoutTimer = null;
    }

    state.authenticated = true;
    state.tenantId = ticketData.tenantId;
    state.authorizedSessionIds = new Set(ticketData.sessionIds);

    this.send(socket, {
      type: 'authenticated',
      connectionId: state.connectionId,
    });
  }

  private handleSubscribe(
    socket: WebSocket,
    state: ClientConnectionState,
    msg: { action: 'subscribe'; sessionId: string }
  ): void {
    if (!state.authenticated || !state.tenantId) {
      this.sendError(socket, 'UNAUTHENTICATED', 'Must authenticate connection before subscribing');
      return;
    }

    const { sessionId } = msg;
    if (!sessionId || typeof sessionId !== 'string') {
      this.sendError(socket, 'BAD_REQUEST', 'Valid sessionId required');
      return;
    }

    // Enforce ticket session scope
    if (!state.authorizedSessionIds.has(sessionId)) {
      this.sendError(socket, 'SESSION_FORBIDDEN', 'The session is not available to this client.');
      return;
    }

    if (state.subscribedSessionIds.size >= this.options.maxSubscriptionsPerSocket) {
      this.sendError(
        socket,
        'MAX_SUBSCRIPTIONS_EXCEEDED',
        `Maximum subscriptions (${this.options.maxSubscriptionsPerSocket}) per connection exceeded`
      );
      return;
    }

    state.subscribedSessionIds.add(sessionId);

    this.send(socket, {
      type: 'subscribed',
      sessionId,
    });
  }

  private handleUnsubscribe(
    socket: WebSocket,
    state: ClientConnectionState,
    msg: { action: 'unsubscribe'; sessionId: string }
  ): void {
    if (!state.authenticated) {
      this.sendError(socket, 'UNAUTHENTICATED', 'Must authenticate connection before unsubscribing');
      return;
    }

    const { sessionId } = msg;
    if (sessionId) {
      state.subscribedSessionIds.delete(sessionId);
      this.send(socket, {
        type: 'unsubscribed',
        sessionId,
      });
    }
  }

  private handlePing(
    socket: WebSocket,
    state: ClientConnectionState,
    _msg: { action: 'ping'; clientTime?: string }
  ): void {
    state.lastPingAt = Date.now();
    this.send(socket, {
      type: 'pong',
      serverTime: new Date().toISOString(),
    });
  }

  /**
   * Broadcasts a validated and persisted event to all subscribers authorized for this tenant and session.
   * Satisfies the RealtimeBroadcaster interface expected by EventIngestionService.
   */
  public broadcast(tenantId: string, sessionId: string, event: any): void {
    if (!tenantId || !sessionId || !event) return;

    const payload: ServerMessage = {
      type: 'event',
      event: {
        eventId: event.eventId ?? event.id,
        sessionId,
        type: event.type,
        occurredAt: event.occurredAt instanceof Date ? event.occurredAt.toISOString() : event.occurredAt,
        receivedAt: event.receivedAt instanceof Date ? event.receivedAt.toISOString() : event.receivedAt,
        user: event.user
          ? {
              id: event.user.id,
              platform: event.user.platform ?? 'tiktok',
              platformUserId: event.user.platformUserId ?? null,
              uniqueId: event.user.uniqueId ?? null,
              nickname: event.user.nickname ?? null,
              avatarUrl: event.user.avatarUrl ?? null,
              verified: event.user.verified ?? null,
              identityQuality: event.user.identityQuality ?? 'platform_id',
              firstSeenAt:
                event.user.firstSeenAt instanceof Date
                  ? event.user.firstSeenAt.toISOString()
                  : event.user.firstSeenAt,
              lastSeenAt:
                event.user.lastSeenAt instanceof Date
                  ? event.user.lastSeenAt.toISOString()
                  : event.user.lastSeenAt,
              profileObservedAt:
                event.user.profileObservedAt instanceof Date
                  ? event.user.profileObservedAt.toISOString()
                  : event.user.profileObservedAt ?? null,
            }
          : null,
        data: event.data ?? {},
        source: event.source ?? { connector: 'tiktok-live-connector' },
      },
    };

    const messageString = JSON.stringify(payload);

    for (const [socket, state] of this.connections.entries()) {
      if (
        state.authenticated &&
        state.tenantId === tenantId &&
        state.subscribedSessionIds.has(sessionId) &&
        socket.readyState === WebSocket.OPEN
      ) {
        try {
          socket.send(messageString);
        } catch {
          // ignore transient socket send error
        }
      }
    }
  }

  /**
   * Sends a JSON server message to a specific socket.
   */
  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // ignore
      }
    }
  }

  /**
   * Formats and delivers an error envelope conforming to WEBSOCKET_PROTOCOL.md.
   */
  private sendError(socket: WebSocket, code: string, message: string): void {
    this.send(socket, {
      type: 'error',
      error: {
        code,
        message,
      },
    });
  }

  /**
   * Counts active authenticated sockets belonging to a specific tenant.
   */
  public countTenantConnections(tenantId: string): number {
    let count = 0;
    for (const state of this.connections.values()) {
      if (state.authenticated && state.tenantId === tenantId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Returns active connections count.
   */
  public getActiveConnectionsCount(): number {
    return this.connections.size;
  }

  /**
   * Sweeps idle or unresponsive connections.
   */
  public heartbeatSweep(): void {
    const now = Date.now();
    for (const [socket, state] of this.connections.entries()) {
      if (now - state.lastPingAt > this.options.idleTimeoutMs) {
        try {
          socket.close(1000, 'Idle timeout');
        } catch {
          // ignore
        }
        this.cleanupConnection(socket);
      }
    }
  }

  private cleanupConnection(socket: WebSocket): void {
    const state = this.connections.get(socket);
    if (state) {
      if (state.authTimeoutTimer) {
        clearTimeout(state.authTimeoutTimer);
        state.authTimeoutTimer = null;
      }
      this.connections.delete(socket);
    }
  }

  /**
   * Destroys all connections and clears intervals.
   */
  public destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [socket, state] of this.connections.entries()) {
      if (state.authTimeoutTimer) {
        clearTimeout(state.authTimeoutTimer);
      }
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        // ignore
      }
    }
    this.connections.clear();
  }
}
