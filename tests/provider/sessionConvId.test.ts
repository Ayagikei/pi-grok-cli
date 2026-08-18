import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionConvId,
  isProxySessionError,
  SESSION_CONV_ENTRY,
} from '../../src/provider/sessionConvId.js';

afterEach(() => {
  vi.useRealTimers();
});

function context(sessionId: string, generations: number[] = []) {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getBranch: () =>
        generations.map((generation, index) => ({
          type: 'custom',
          id: `entry-${index}`,
          parentId: index ? `entry-${index - 1}` : null,
          timestamp: new Date(index).toISOString(),
          customType: SESSION_CONV_ENTRY,
          data: { generation },
        })),
    },
  } as unknown as ExtensionContext;
}

describe('proxy session errors', () => {
  it('matches grok proxy 401/502/520 wrappers only', () => {
    expect(isProxySessionError('OpenAI API error (401): 401 "Authentication required"')).toBe(true);
    expect(isProxySessionError('OpenAI API error (502): 502 status code (no body)')).toBe(true);
    expect(isProxySessionError('OpenAI API error (520): 520 status code (no body)')).toBe(true);
    expect(
      isProxySessionError('OpenAI API error (402): 402 "Grok Build usage balance exhausted"'),
    ).toBe(false);
    expect(isProxySessionError('Request timed out.')).toBe(false);
    expect(isProxySessionError('Connection error.')).toBe(false);
  });
});

describe('Pi session conversation id', () => {
  it('keeps the raw session id until a proxy error rotates it', () => {
    const appendEntry = vi.fn();
    const convIds = createSessionConvId({ appendEntry } as unknown as ExtensionAPI);

    expect(convIds.convId('session-a')).toBe('session-a');
    expect(
      convIds.rotateIfProxyError('session-a', 'OpenAI API error (502): 502 status code (no body)'),
    ).toBe('session-a:1');
    expect(convIds.convId('session-a')).toBe('session-a:1');
    expect(convIds.convId('session-b')).toBe('session-b');
    expect(appendEntry).toHaveBeenCalledWith(SESSION_CONV_ENTRY, { generation: 1 });
  });

  it('dedups the same proxy error within one second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const appendEntry = vi.fn();
    const convIds = createSessionConvId({ appendEntry } as unknown as ExtensionAPI);
    const error = 'OpenAI API error (401): 401 "Authentication required"';

    expect(convIds.rotateIfProxyError('session-a', error)).toBe('session-a:1');
    expect(convIds.rotateIfProxyError('session-a', error)).toBeUndefined();
    vi.setSystemTime(1_000_000 + 1000);
    expect(convIds.rotateIfProxyError('session-a', error)).toBe('session-a:2');
    expect(appendEntry).toHaveBeenCalledTimes(2);
  });

  it('restores the last persisted generation', () => {
    const convIds = createSessionConvId({
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI);

    expect(convIds.restore(context('session-a', [1, 3]))).toBe('session-a:3');
    expect(convIds.convId('session-a')).toBe('session-a:3');
  });
});
