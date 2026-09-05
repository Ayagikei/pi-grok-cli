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

const PROXY_RETRIES = 2;

export function streamWithProxyRetry(options: {
  start: () => ProviderStream;
  retry: () => ProviderStream;
  onMessage: (message: AssistantMessage) => void;
}) {
  const outer = createPassThrough();
  void (async () => {
    let stream = options.start();
    for (let attempt = 0; ; attempt++) {
      let replay = false;
      for await (const event of stream) {
        if (isProxySessionError(errorMessageOf(event)) && attempt < PROXY_RETRIES) {
          replay = true;
          break;
        }
        outer.push(event);
      }
      if (replay) {
        stream = options.retry();
        continue;
      }
      const message = await stream.result();
      if (isProxySessionError(message.errorMessage) && attempt < PROXY_RETRIES) {
        stream = options.retry();
        continue;
      }
      options.onMessage(message);
      outer.end(message);
      return;
    }
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
