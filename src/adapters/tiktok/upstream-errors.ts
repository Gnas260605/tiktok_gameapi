export type UpstreamErrorKind =
  | 'offline'
  | 'not_found'
  | 'sign_rejected'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface ClassifiedUpstreamError {
  kind: UpstreamErrorKind;
  retryable: boolean;
  message: string;
}

/**
 * Classifies tiktok-live-connector errors by class name (the library does not
 * export stable error codes) so callers can decide between retrying and stopping.
 */
export function classifyUpstreamError(err: any, username: string): ClassifiedUpstreamError {
  const name: string = err?.constructor?.name || err?.name || '';
  const raw: string = err?.message || String(err);

  if (name === 'UserOfflineError' || /offline|LIVE_NOT_FOUND|ROOM_OFFLINE/i.test(raw)) {
    return { kind: 'offline', retryable: false, message: `@${username} is not currently LIVE` };
  }

  if (name === 'InvalidResponseCompositeError' || name === 'InvalidUniqueIdError') {
    return {
      kind: 'not_found',
      retryable: false,
      message: `TikTok user @${username} was not found or TikTok blocked the lookup`,
    };
  }

  if (name === 'SignatureRateLimitError' || /rate.?limit|429/i.test(raw)) {
    return { kind: 'rate_limited', retryable: true, message: `TikTok sign server rate limit reached: ${raw}` };
  }

  if (/Sign|Premium|Authenticated/.test(name) || /sign a request|eulerstream|Business plan|api key/i.test(raw)) {
    const hint = process.env.TIKTOK_SIGN_API_KEY
      ? 'Check that TIKTOK_SIGN_API_KEY is valid and that TIKTOK_EXTENDED_GIFT_INFO is not enabled on a plan without gift access.'
      : 'Set TIKTOK_SIGN_API_KEY (https://www.eulerstream.com).';
    return { kind: 'sign_rejected', retryable: false, message: `TikTok sign server rejected the connection. ${hint} Upstream: ${raw}` };
  }

  if (name === 'ConnectTimeoutError' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|timeout/i.test(raw)) {
    return { kind: 'network', retryable: true, message: raw };
  }

  return { kind: 'unknown', retryable: true, message: raw };
}
