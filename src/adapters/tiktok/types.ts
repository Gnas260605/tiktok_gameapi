import { EventEmitter } from 'events';
import {
  SessionStatus,
  IdentityQuality,
  EventType,
} from '@prisma/client';

export {
  SessionStatus,
  IdentityQuality,
  EventType,
};

/**
 * 7 Connection lifecycle states matching Prisma SessionStatus enum and OpenAPI contract.
 */
export type ConnectionStatus =
  | 'queued'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'ended'
  | 'failed';

/**
 * 7 TikTok LIVE user interaction event types.
 */
export type TikTokEventType =
  | 'member'
  | 'chat'
  | 'gift'
  | 'like'
  | 'follow'
  | 'share'
  | 'roomUser';

/**
 * Standardized user identity snapshot extracted from LIVE events.
 */
export interface NormalizedUser {
  id?: string;                           // TikUser database UUID (populated upon upsert)
  platform: 'tiktok';                    // Platform discriminator
  platformUserId: string | null;         // Upstream permanent user ID (e.g. "7189123456789012345")
  uniqueId: string | null;               // Upstream username/handle without '@' (e.g. "streamer_jane")
  nickname: string | null;               // Display name
  avatarUrl: string | null;              // Validated HTTP/HTTPS avatar URL
  verified: boolean | null;              // Verification badge status
  identityQuality: IdentityQuality;      // Quality grading (platform_id | handle_fallback | event_only)
  firstSeenAt?: Date;                    // First observation timestamp
  lastSeenAt?: Date;                     // Most recent observation timestamp
  profileObservedAt?: Date | null;       // Profile observation timestamp
}

/**
 * Payload contract for 'member' (room join) event.
 */
export interface MemberPayload {
  joinMethod?: string | null;            // e.g. "enter_room", "share_link"
  sourceFields?: Record<string, any> | null;
}

/**
 * Payload contract for 'chat' (viewer comment) event.
 * Dual-field text/comment mapping ensures compatibility with both OpenAPI and dispatch specs.
 */
export interface ChatPayload {
  comment: string;                       // Primary comment text
  text: string;                          // Synonym for comment text per PRD §6.5 & OpenAPI
  messageId?: string | null;             // Upstream Webcast message ID if provided
  emotes?: Array<{ id: string; url?: string }> | null;
}

/**
 * Payload contract for 'gift' (virtual gift sent) event.
 */
export interface GiftPayload {
  giftId: string | number;               // Identifier in TikTok gift catalog
  giftName: string;                      // Display name (e.g. "Rose", "Lion", "Galaxy")
  diamondCount?: number | null;          // Diamond/coin unit value (never fabricated)
  repeatCount: number;                   // Combo streak count (defaults to 1)
  repeatEnd?: boolean | null;            // True when combo streak has concluded
  giftType?: number | null;              // Upstream gift classification code
  groupId?: string | null;               // Upstream streak grouping identifier
}

/**
 * Payload contract for 'like' (screen tap) event.
 */
export interface LikePayload {
  likeCount: number;                     // Delta likes sent in this specific batch (>= 1)
  totalLikes?: number | null;            // Cumulative room likes if reported by connector
}

/**
 * Payload contract for 'follow' event.
 */
export interface FollowPayload {
  followType?: string | null;            // Action classification
  sourceFields?: Record<string, any> | null;
}

/**
 * Payload contract for 'share' event.
 */
export interface SharePayload {
  shareType?: string | null;             // Medium (e.g. "whatsapp", "copy_link")
  shareTarget?: string | null;           // Target destination
}

/**
 * Payload contract for 'roomUser' (viewer count statistics) event.
 * CRITICAL: user MUST ALWAYS be null for this event type.
 */
export interface RoomUserPayload {
  viewerCount: number;                   // Current concurrent viewers (integer >= 0)
}

/**
 * Map of event types to their corresponding payloads.
 */
export type EventPayloadMap = {
  member: MemberPayload;
  chat: ChatPayload;
  gift: GiftPayload;
  like: LikePayload;
  follow: FollowPayload;
  share: SharePayload;
  roomUser: RoomUserPayload;
  connected: { roomId: string };
  disconnected: { reason?: string };
  reconnecting: { attempt: number; delayMs: number };
  ended: { reason?: string };
  statusChange: { from: ConnectionStatus; to: ConnectionStatus; sessionId?: string; reason?: string; timestamp: Date };
  error: { code?: string; message: string; details?: any };
};

/**
 * Canonical Event Envelope emitted by all ITikTokLiveConnector implementations.
 */
export interface CanonicalEvent<T = Record<string, any>> {
  id?: string;                           // Upstream ID or explicit test event ID (omitted if absent upstream)
  tenantId: string;                      // Owning tenant UUID
  sessionId: string;                     // Scoped LIVE session UUID
  eventType: EventType;                  // member | chat | gift | like | follow | share | roomUser
  eventTimestamp: Date;                  // Upstream occurred_at timestamp
  user: NormalizedUser | null;           // Normalized user (STRICTLY null for roomUser)
  payload: T;                            // Type-specific event data payload
  source?: {
    connector: string;                   // "mock-connector" | "tiktok-live-connector"
    connectorVersion?: string | null;    // Connector library version string
  };
}

/**
 * Room metadata retrieved upon successful connection.
 */
export interface RoomInfo {
  roomId: string;                        // Unique TikTok room ID
  creatorUsername: string;               // Normalized streamer username (lowercase, no '@')
  title?: string | null;                 // Stream title if available
  viewerCount?: number | null;           // Initial viewer count
  startedAt?: Date | null;               // Broadcast start timestamp
}

/**
 * Configuration options supplied when establishing a connector session.
 */
export interface ConnectorOptions {
  sessionId: string;                     // Mandatory TikUser LiveSession UUID
  tenantId: string;                      // Mandatory TikUser Tenant UUID
  enableExtendedGiftInfo?: boolean;      // Whether to fetch extended gift metadata
  requestPollingIntervalMs?: number;     // Fallback polling interval if WebSocket degraded
  clientParams?: Record<string, any>;    // Custom parameters passed to upstream library
  maxReconnectAttempts?: number;         // Default: 5 attempts
  initialReconnectDelayMs?: number;      // Default: 1000ms
  maxReconnectDelayMs?: number;          // Default: 30000ms
  reconnectBackoffFactor?: number;       // Default: 2.0
  isMock?: boolean;                      // Forces MockConnector instantiation
  mockTickerIntervalMs?: number;         // Interval for background mock ticker (default: 1000ms)
}

/**
 * Result returned upon connection attempt completion.
 */
export interface ConnectionResult {
  success: boolean;                      // True if connection transitioned to 'connected'
  roomId?: string;                       // Connected room ID
  status: ConnectionStatus;              // Final status
  error?: string;                        // Error diagnostic message if failed
}

/**
 * Core decoupled adapter interface for TikTok LIVE connectors.
 */
export interface ITikTokLiveConnector extends EventEmitter {
  connect(creatorUsername: string, options?: ConnectorOptions): Promise<ConnectionResult>;
  disconnect(reason?: string): Promise<void>;
  getStatus(): ConnectionStatus;
  getRoomInfo(): RoomInfo | null;
  isConnected(): boolean;

  // Strongly typed event emitter method overrides:
  emit(event: string | symbol, ...args: any[]): boolean;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
}
