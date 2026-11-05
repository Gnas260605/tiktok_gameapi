import { EventEmitter } from 'events';

export interface GameEventPayload {
  tenantId: string;
  sessionId: string;
  event: any;
  user: any;
}

export type GameEventListener = (payload: GameEventPayload) => void | Promise<void>;

/**
 * GameEventBus - Thin, non-blocking EventEmitter connecting TikTok event ingestion to Tu Tien game processor.
 * References:
 * - docs/game/05_Architecture.md §1, §3
 * - docs/game/AUDIT.md §6.3
 */
export class GameEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Safely publishes an ingested TikTok canonical event to all registered game listeners.
   * Guarantees non-blocking execution and isolates ingestion from game runtime exceptions.
   */
  public publish(
    tenantId: string,
    sessionId: string,
    persistedEvent: any,
    persistedUser: any
  ): void {
    const payload: GameEventPayload = {
      tenantId,
      sessionId,
      event: persistedEvent,
      user: persistedUser,
    };

    try {
      this.emit('event', payload);
      if (persistedEvent?.eventType) {
        this.emit(`event:${persistedEvent.eventType}`, payload);
      }
    } catch (err: any) {
      console.warn(`[GameEventBus] Error while emitting event: ${err.message}`);
    }
  }

  /**
   * Subscribes to all events emitted on the bus.
   * Returns an unsubscribe function for cleanup.
   */
  public subscribe(listener: GameEventListener): () => void {
    this.on('event', listener);
    return () => {
      this.off('event', listener);
    };
  }

  /**
   * Subscribes to specific event type (e.g. 'gift', 'chat').
   */
  public subscribeToType(eventType: string, listener: GameEventListener): () => void {
    const eventName = `event:${eventType}`;
    this.on(eventName, listener);
    return () => {
      this.off(eventName, listener);
    };
  }
}

export const defaultGameEventBus = new GameEventBus();
