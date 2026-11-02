import {
  TenantStatus,
  ApiKeyStatus,
  SessionStatus,
  IdentityQuality,
  EventType,
} from '@prisma/client';

export {
  TenantStatus,
  ApiKeyStatus,
  SessionStatus,
  IdentityQuality,
  EventType,
};

export interface CursorPagination {
  limit?: number; // default: 50, min: 1, max: 100
  cursor?: string; // opaque base64url cursor encoding { id, timestamp }
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}

// Session DTOs
export interface CreateSessionDto {
  platform?: string; // default: 'tiktok'
  creatorUsername: string;
  roomId?: string | null;
  connectorMetadata?: Record<string, any>;
}

export interface UpdateSessionDetailsDto {
  status?: SessionStatus;
  disconnectReason?: string | null;
  roomId?: string | null;
  connectorMetadata?: Record<string, any>;
  startedAt?: Date | null;
  endedAt?: Date | null;
}

export interface ListSessionsFilter {
  status?: SessionStatus;
  platform?: string;
  creatorUsername?: string;
}

// User DTOs
export interface UpsertUserDto {
  platform?: string; // default: 'tiktok'
  platformUserId?: string | null;
  uniqueId?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  verified?: boolean | null;
  identityQuality?: IdentityQuality;
  profileObservedAt?: Date | null;
}

export interface ListUsersFilter {
  search?: string; // matches uniqueId or nickname (case-insensitive)
  sessionId?: string; // users active in specific session
}

// Event DTOs
export interface CreateEventDto {
  sessionId: string;
  userId?: string | null;
  eventType: EventType;
  occurredAt: Date;
  receivedAt?: Date;
  data: Record<string, any>;
  sourceEventId?: string | null;
  payloadFingerprint?: string | null;
  connectorName?: string | null;
  connectorVersion?: string | null;
}

export interface ListEventsFilter {
  sessionId?: string;
  userId?: string;
  eventType?: EventType;
  from?: Date;
  to?: Date;
}

// API Key DTOs
export interface CreateApiKeyDto {
  name: string;
  keyPrefix: string;
  keyHash: string;
  expiresAt?: Date | null;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  reason?: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'TENANT_INACTIVE';
  apiKey?: any;
  tenant?: any;
}

// Tenant Settings DTOs
export interface UpsertTenantSettingsDto {
  eventRetentionDays?: number;
  maxActiveSessions?: number;
  settings?: Record<string, any>;
}
