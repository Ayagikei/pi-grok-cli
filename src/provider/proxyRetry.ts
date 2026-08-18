import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import { isProxySessionError } from './sessionConvId.js';

type ProviderStream = AsyncIterable<AssistantMessageEvent> & {
  result: () => Promise<AssistantMessage>;
};

function errorMessageOf(event: AssistantMessageEvent) {
  if (event.type !== 'error') return undefined;
  return event.error.errorMessage;
}

function createPassThrough() {
  const events: AssistantMessageEvent[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let final: AssistantMessage | undefined;
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  return {
    push(event: AssistantMessageEvent) {
      events.push(event);
      wake();
    },
    end(message: AssistantMessage) {
      done = true;
      final = message;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      let index = 0;
      while (true) {
        if (index < events.length) {
          yield events[index];
          index += 1;
          continue;
        }
        if (done) return;
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
        });
      }
    },
    result() {
      if (done && final) return Promise.resolve(final);
      return new Promise<AssistantMessage>((resolve) => {
        const check = () => {
          if (done && final) resolve(final);
          if (!done || !final) waiters.push(check);
        };
        check();
      });
    },
  };
}

export function streamWithProxyRetry(options: {
  start: () => ProviderStream;
  retry: () => ProviderStream;
  onMessage: (message: AssistantMessage) => void;
}) {
  const outer = createPassThrough();
  void (async () => {
    const first = options.start();
    for await (const event of first) {
      if (isProxySessionError(errorMessageOf(event))) {
        const second = options.retry();
        for await (const retryEvent of second) outer.push(retryEvent);
        const message = await second.result();
        options.onMessage(message);
        outer.end(message);
        return;
      }
      outer.push(event);
    }
    const message = await first.result();
    if (isProxySessionError(message.errorMessage)) {
      const second = options.retry();
      for await (const retryEvent of second) outer.push(retryEvent);
      const retried = await second.result();
      options.onMessage(retried);
      outer.end(retried);
      return;
    }
    options.onMessage(message);
    outer.end(message);
  })().catch((error) => {
    const message = {
      role: 'assistant',
      content: [],
      stopReason: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
    } as unknown as AssistantMessage;
    outer.push({ type: 'error', reason: 'error', error: message });
    outer.end(message);
  });
  return outer;
}
