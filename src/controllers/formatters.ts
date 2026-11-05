import { User, Event, LiveSession } from '@prisma/client';

export function formatUser(user: User | null | undefined): any {
  if (!user) return null;
  return {
    id: user.id,
    platform: user.platform,
    platformUserId: user.platformUserId,
    uniqueId: user.uniqueId,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    verified: user.verified,
    identityQuality: user.identityQuality,
    firstSeenAt: user.firstSeenAt.toISOString(),
    lastSeenAt: user.lastSeenAt.toISOString(),
    profileObservedAt: user.profileObservedAt ? user.profileObservedAt.toISOString() : null,
  };
}

export function formatEvent(event: (Event & { user?: User | null }) | null | undefined): any {
  if (!event) return null;
  return {
    eventId: event.id,
    sessionId: event.sessionId,
    type: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
    user: formatUser(event.user),
    data: (event.data as any) ?? {},
    source: {
      connector: event.connectorName || 'tiktok-live-connector',
      connectorVersion: event.connectorVersion || null,
    },
  };
}

export function formatSession(session: LiveSession | null | undefined): any {
  if (!session) return null;
  return {
    id: session.id,
    platform: session.platform,
    creatorUsername: session.creatorUsername,
    roomId: session.roomId,
    status: session.status,
    disconnectReason: session.disconnectReason,
    startedAt: session.startedAt ? session.startedAt.toISOString() : null,
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    metadata: (session.connectorMetadata as any) ?? {},
  };
}
