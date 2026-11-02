import { PrismaClient } from '@prisma/client';

export interface DecodedCursor {
  id: string;
  timestamp: string;
}

export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaClient) {}

  /**
   * Encodes an id and timestamp into a web-safe opaque cursor string.
   */
  protected encodeCursor(id: string, timestamp: Date | string): string {
    const ts = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    const payload = JSON.stringify({ id, timestamp: ts });
    return Buffer.from(payload, 'utf8').toString('base64url');
  }

  /**
   * Decodes an opaque cursor string back into id and timestamp.
   * Returns null if cursor is missing, malformed, or contains an invalid date timestamp.
   */
  protected decodeCursor(cursor?: string): DecodedCursor | null {
    if (!cursor) return null;
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(json);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.id === 'string' &&
        parsed.id.trim().length > 0 &&
        typeof parsed.timestamp === 'string' &&
        !isNaN(new Date(parsed.timestamp).getTime())
      ) {
        return parsed as DecodedCursor;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Normalizes pagination limit within safe bounds (1..100).
   */
  protected normalizeLimit(limit?: number, defaultLimit = 50, maxLimit = 100): number {
    if (!limit || limit <= 0) return defaultLimit;
    return Math.min(limit, maxLimit);
  }
}
