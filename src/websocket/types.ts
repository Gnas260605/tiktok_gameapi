import { WebSocket } from 'ws';

export type ClientAction = 'authenticate' | 'subscribe' | 'unsubscribe' | 'ping';

export interface AuthenticateMessage {
  action: 'authenticate';
  ticket: string;
}

export interface SubscribeMessage {
  action: 'subscribe';
  sessionId: string;
}

export interface UnsubscribeMessage {
  action: 'unsubscribe';
  sessionId: string;
}

export interface PingMessage {
  action: 'ping';
  clientTime?: string;
}

export type ClientMessage =
  | AuthenticateMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage;

export interface AuthenticatedResponse {
  type: 'authenticated';
  connectionId: string;
}

export interface SubscribedResponse {
  type: 'subscribed';
  sessionId: string;
}

export interface UnsubscribedResponse {
  type: 'unsubscribed';
  sessionId: string;
}

export interface EventBroadcastMessage {
  type: 'event';
  event: {
    eventId: string;
    sessionId: string;
    type: string;
    occurredAt: string;
    receivedAt: string;
    user: any | null;
    data: Record<string, any>;
    source?: Record<string, any>;
  };
}

export interface PongResponse {
  type: 'pong';
  serverTime: string;
}

export interface ErrorResponse {
  type: 'error';
  error: {
    code: string;
    message: string;
  };
}

export type ServerMessage =
  | AuthenticatedResponse
  | SubscribedResponse
  | UnsubscribedResponse
  | EventBroadcastMessage
  | PongResponse
  | ErrorResponse;

export interface ClientConnectionState {
  connectionId: string;
  socket: WebSocket;
  tenantId: string | null;
  authenticated: boolean;
  authorizedSessionIds: Set<string>;
  subscribedSessionIds: Set<string>;
  connectedAt: Date;
  lastPingAt: number;
  authTimeoutTimer: NodeJS.Timeout | null;
}

export interface WebSocketManagerOptions {
  authTimeoutMs?: number;        // default: 5000 ms (5s to send authenticate action)
  heartbeatIntervalMs?: number;  // default: 30000 ms (30s heartbeat sweep)
  idleTimeoutMs?: number;        // default: 60000 ms (60s without ping)
  maxConnectionsPerTenant?: number; // default: 50
  maxSubscriptionsPerSocket?: number; // default: 20
  maxMessageSize?: number;       // default: 65536 bytes (64KB)
}
