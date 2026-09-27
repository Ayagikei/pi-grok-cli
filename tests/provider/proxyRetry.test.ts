import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { describe, expect, it, vi } from 'vitest';
import { streamWithProxyRetry } from '../../src/provider/proxyRetry.js';

function streamOf(events: AssistantMessageEvent[], message: AssistantMessage) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    result: async () => message,
  };
}

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const failed: AssistantMessage = {
  role: 'assistant',
  content: [],
  api: 'openai-responses',
  provider: 'grok-cli',
  model: 'grok-4.6',
  usage,
  stopReason: 'error',
  errorMessage: 'grok-cli API error (401): 401 "Authentication required"',
  timestamp: 1,
};

const succeeded: AssistantMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'ok' }],
  api: 'openai-responses',
  provider: 'grok-cli',
  model: 'grok-4.6',
  usage,
  stopReason: 'stop',
  timestamp: 2,
};

describe('streamWithProxyRetry', () => {
  async function collect(stream: ReturnType<typeof streamWithProxyRetry>) {
    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) events.push(event);
    return { events, message: await stream.result() };
  }

  async function hide401(
    retry: ReturnType<typeof vi.fn<() => ReturnType<typeof streamOf>>>,
    times: number,
  ) {
    const onMessage = vi.fn();
    const { events, message } = await collect(
      streamWithProxyRetry({
        start: () => streamOf([{ type: 'error', reason: 'error', error: failed }], failed),
        retry,
        onMessage,
      }),
    );
    expect(events).toEqual([{ type: 'done', reason: 'stop', message: succeeded }]);
    expect(message).toEqual(succeeded);
    expect(retry).toHaveBeenCalledTimes(times);
    expect(onMessage).toHaveBeenCalledWith(succeeded);
  }

  it('retries a 401 once and hides the first error', async () => {
    await hide401(
      vi.fn(() => streamOf([{ type: 'done', reason: 'stop', message: succeeded }], succeeded)),
      1,
    );
  });

  it('does not retry a successful stream', async () => {
    const retry = vi.fn();
    const { events } = await collect(
      streamWithProxyRetry({
        start: () => streamOf([{ type: 'done', reason: 'stop', message: succeeded }], succeeded),
        retry,
        onMessage: vi.fn(),
      }),
    );

    expect(events).toHaveLength(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a 401 twice if the first replay also fails', async () => {
    const retry = vi.fn();
    retry
      .mockImplementationOnce(() =>
        streamOf([{ type: 'error', reason: 'error', error: failed }], failed),
      )
      .mockImplementationOnce(() =>
        streamOf([{ type: 'done', reason: 'stop', message: succeeded }], succeeded),
      );
    await hide401(retry, 2);
  });
});
