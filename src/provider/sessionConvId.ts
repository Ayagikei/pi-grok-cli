import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export const SESSION_CONV_ENTRY = 'grok-cli-conv-id-v1';
const DEDUP_MS = 1000;

export function isProxySessionError(errorMessage: unknown) {
  return (
    typeof errorMessage === 'string' && /OpenAI API error \((401|502|520)\)/.test(errorMessage)
  );
}

function storedGeneration(
  entry: ReturnType<ExtensionContext['sessionManager']['getBranch']>[number],
) {
  if (entry.type !== 'custom' || entry.customType !== SESSION_CONV_ENTRY) return undefined;
  if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) return undefined;
  const generation = (entry.data as Record<string, unknown>).generation;
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 1) {
    return undefined;
  }
  return generation;
}

export function createSessionConvId(pi: Pick<ExtensionAPI, 'appendEntry'>) {
  const generations = new Map<string, number>();
  const lastRotate = new Map<string, { errorMessage: string; at: number }>();

  const convId = (sessionId: string | undefined) => {
    if (!sessionId) return sessionId;
    const generation = generations.get(sessionId) ?? 0;
    return generation > 0 ? `${sessionId}:${generation}` : sessionId;
  };

  return {
    convId,
    restore(ctx: Pick<ExtensionContext, 'sessionManager'>) {
      const sessionId = ctx.sessionManager.getSessionId();
      const restored = ctx.sessionManager
        .getBranch()
        .reduceRight<number | undefined>(
          (generation, entry) => generation ?? storedGeneration(entry),
          undefined,
        );
      if (restored) generations.set(sessionId, restored);
      if (!restored) generations.delete(sessionId);
      return convId(sessionId);
    },
    rotateIfProxyError(sessionId: string | undefined, errorMessage: unknown) {
      if (!sessionId || !isProxySessionError(errorMessage)) return undefined;
      const now = Date.now();
      const previous = lastRotate.get(sessionId);
      if (previous && previous.errorMessage === errorMessage && now - previous.at < DEDUP_MS) {
        return undefined;
      }
      lastRotate.set(sessionId, { errorMessage: String(errorMessage), at: now });
      generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
      pi.appendEntry(SESSION_CONV_ENTRY, { generation: generations.get(sessionId) });
      return convId(sessionId);
    },
    clear(sessionId: string) {
      generations.delete(sessionId);
      lastRotate.delete(sessionId);
    },
  };
}

export type SessionConvId = ReturnType<typeof createSessionConvId>;
