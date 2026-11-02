import { ITikTokLiveConnector, ConnectorOptions } from './types';
import { MockConnector } from './mock.connector';
import { LiveTikTokConnector } from './live.connector';
import { UserNormalizationService } from '../../services/user/user-normalization.service';

export class ConnectorFactory {
  private static userNormalizationService = new UserNormalizationService();

  /**
   * Creates an ITikTokLiveConnector instance based on options and environment settings.
   */
  public static createConnector(options?: Partial<ConnectorOptions>): ITikTokLiveConnector {
    const isMockExplicit = options?.isMock;
    const isMockEnv =
      process.env.TIKTOK_CONNECTOR_MODE === 'mock' ||
      process.env.USE_MOCK_CONNECTOR === 'true' ||
      process.env.NODE_ENV === 'test';

    const useMock = isMockExplicit !== undefined ? isMockExplicit : isMockEnv;

    if (useMock) {
      return new MockConnector();
    }

    return new LiveTikTokConnector(this.userNormalizationService);
  }

  /**
   * Explicit factory helper for unit & integration testing.
   */
  public static createMockConnector(): MockConnector {
    return new MockConnector();
  }

  /**
   * Explicit factory helper for production live streaming.
   */
  public static createLiveConnector(): LiveTikTokConnector {
    return new LiveTikTokConnector(this.userNormalizationService);
  }
}
