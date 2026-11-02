import { EventEmitter } from 'events';
import {
  ITikTokLiveConnector,
  ConnectionStatus,
  ConnectorOptions,
  ConnectionResult,
  RoomInfo,
} from './types';

/**
 * Valid state transition graph. Any transition not defined here is blocked as illegal.
 */
const VALID_TRANSITIONS: Record<ConnectionStatus, ConnectionStatus[]> = {
  queued: ['connecting', 'failed', 'disconnected'],
  connecting: ['connected', 'ended', 'failed', 'disconnected'],
  connected: ['reconnecting', 'ended', 'disconnected', 'failed'],
  reconnecting: ['connected', 'ended', 'failed', 'disconnected'],
  disconnected: [], // Terminal
  ended: [],        // Terminal
  failed: [],       // Terminal
};

export abstract class BaseConnector extends EventEmitter implements ITikTokLiveConnector {
  protected status: ConnectionStatus = 'queued';
  protected roomInfo: RoomInfo | null = null;
  protected options: ConnectorOptions | null = null;
  protected creatorUsername: string = '';
  protected reconnectAttempts: number = 0;
  protected reconnectTimer: NodeJS.Timeout | null = null;
  protected isExplicitlyStopped: boolean = false;
  protected maxRetries: number = 5;

  constructor() {
    super();
    // High listener ceiling to support multiple internal and external observers without warnings
    this.setMaxListeners(100);
  }

  /**
   * Current connector status.
   */
  public getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Room information if connected.
   */
  public getRoomInfo(): RoomInfo | null {
    return this.roomInfo ? { ...this.roomInfo } : null;
  }

  /**
   * Returns true if currently in 'connected' state.
   */
  public isConnected(): boolean {
    return this.status === 'connected';
  }

  /**
   * Abstract connection routine implemented by concrete subclasses.
   */
  public abstract connect(
    creatorUsername: string,
    options?: ConnectorOptions
  ): Promise<ConnectionResult>;

  /**
   * Abstract disconnection routine implemented by concrete subclasses.
   */
  public abstract disconnect(reason?: string): Promise<void>;

  /**
   * Transitions connector to a new status according to state machine rules.
   * Emits 'statusChange' and lifecycle events.
   */
  protected transitionTo(newStatus: ConnectionStatus, reason?: string): boolean {
    const current = this.status;
    if (current === newStatus) return true;

    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(newStatus)) {
      this.safeLog('warn', `Illegal state transition attempted from '${current}' to '${newStatus}'`);
      return false;
    }

    this.status = newStatus;
    this.safeLog('info', `State transition: ${current} -> ${newStatus}${reason ? ` (Reason: ${reason})` : ''}`);

    // Emit general statusChange event
    this.safeEmit('statusChange', {
      from: current,
      to: newStatus,
      sessionId: this.options?.sessionId,
      reason,
      timestamp: new Date(),
    });

    // Emit specific lifecycle events
    if (newStatus === 'connected' && this.roomInfo) {
      this.safeEmit('connected', { roomId: this.roomInfo.roomId });
    } else if (newStatus === 'reconnecting') {
      this.safeEmit('reconnecting', { attempt: this.reconnectAttempts, delayMs: 0, reason });
    } else if (newStatus === 'disconnected') {
      this.safeEmit('disconnected', { reason: reason ?? 'STOPPED_BY_USER' });
      this.clearReconnectTimer();
    } else if (newStatus === 'ended') {
      this.safeEmit('ended', { reason: reason ?? 'LIVE_ENDED' });
      this.clearReconnectTimer();
    } else if (newStatus === 'failed') {
      this.safeEmit('failed', { reason: reason ?? 'FAILED' });
      this.clearReconnectTimer();
    }

    return true;
  }

  /**
   * Emits an event safely, isolating any errors thrown by downstream listeners
   * to prevent unhandled exceptions or crashes.
   */
  public safeEmit(event: string | symbol, ...args: any[]): boolean {
    try {
      return super.emit(event, ...args);
    } catch (err: any) {
      this.safeLog('error', `Unhandled exception in listener for event '${String(event)}': ${err.message}`, err.stack);
      return false;
    }
  }

  /**
   * Override emit to ensure errors in listeners do not bubble up destructively.
   */
  public override emit(event: string | symbol, ...args: any[]): boolean {
    return this.safeEmit(event, ...args);
  }

  /**
   * Computes exponential backoff delay with Full Jitter in milliseconds.
   * Formula: random_uniform(0, min(T_max, T_0 * (F ^ attempt)))
   * T_0 = 1000ms, T_max = 30000ms, F = 2.0, maxRetries = 5
   */
  public calculateBackoffDelay(attempt: number): number {
    const initialMs = this.options?.initialReconnectDelayMs ?? 1000;
    const maxMs = this.options?.maxReconnectDelayMs ?? 30000;
    const factor = this.options?.reconnectBackoffFactor ?? 2.0;

    const exponentialDelay = Math.min(maxMs, initialMs * Math.pow(factor, attempt));
    // Full jitter: uniformly distributed between 0 and exponentialDelay
    const jitteredDelay = Math.floor(Math.random() * (exponentialDelay + 1));

    return Math.max(50, jitteredDelay); // Enforce reasonable floor
  }

  /**
   * Cancels active reconnect timer if running.
   */
  protected clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Sanitizes creator username: trims whitespace, strips leading '@', forces lowercase.
   */
  public normalizeCreatorUsername(username: string): string {
    return username.trim().replace(/^@+/, '').toLowerCase();
  }

  /**
   * Structured internal logger.
   */
  protected safeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any): void {
    const logObj = {
      timestamp: new Date().toISOString(),
      connector: this.constructor.name,
      sessionId: this.options?.sessionId,
      tenantId: this.options?.tenantId,
      status: this.status,
      message,
      ...(meta && { meta }),
    };

    if (level === 'error') {
      console.error(JSON.stringify(logObj));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logObj));
    } else {
      // In tests and normal dev, debug/info logs can be suppressed or formatted
      if (process.env.DEBUG_CONNECTORS === 'true') {
        console.log(JSON.stringify(logObj));
      }
    }
  }
}
