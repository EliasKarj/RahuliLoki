/**
 * Outbound HTTP guardrails, shared by everything that talks to GGG or poe.ninja.
 *
 * Two failure modes this exists to stop, both of which are ordinary bad-network events rather
 * than attacks — which is exactly why they are worth handling:
 *
 * A connection that opens and then never finishes. `fetch` has no default timeout, and a poll
 * is not finished until every tab it asked for has answered. One hung socket therefore does not
 * slow the poller down, it stops it: that tab never resolves, every later poll finds the
 * previous one still "running", and no snapshot is ever written again until the process is
 * restarted by hand. A handful of requests may be in flight at once, which changes how many
 * sockets can hang and nothing about what one hanging socket costs. `timeoutSignal` bounds it.
 *
 * A response that never stops arriving. `response.json()` buffers the whole body first, so an
 * endpoint that streams without end — a proxy error page in a redirect loop, a mangled quad tab
 * — is an out-of-memory kill on a 512 MB machine. `readJsonCapped` reads with a ceiling and
 * gives up at it.
 */

/** A full quad tab and poe.ninja's largest overview both sit comfortably under this. */
export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export class HttpLimitError extends Error {}

/**
 * An abort signal for one attempt, merged with any caller-supplied signal.
 *
 * Built fresh per attempt on purpose: `AbortSignal.timeout` starts counting when it is created,
 * so a signal reused across retries would give the last attempt no time at all.
 */
export function timeoutSignal(timeoutMs: number, existing?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!existing) return timeout;
  return AbortSignal.any([existing, timeout]);
}

/**
 * Read a JSON body with a hard byte ceiling.
 *
 * Content-Length is checked first when it is present, so an oversized response is refused
 * before a single byte of it is buffered. It is only a hint though — chunked responses carry
 * none — so the streaming path counts for itself and aborts the moment the total goes over.
 */
export async function readJsonCapped(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BYTES,
  label = 'response',
): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpLimitError(
      `${label} declared ${declared} bytes, over the ${maxBytes}-byte ceiling; refusing to read it`,
    );
  }

  const body = response.body;
  if (!body) {
    // No stream to meter (a mocked Response in tests, a 204). The text is already in memory.
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new HttpLimitError(`${label} exceeded the ${maxBytes}-byte ceiling`);
    }
    return parse(text, label);
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new HttpLimitError(`${label} exceeded the ${maxBytes}-byte ceiling`);
      }
      chunks.push(value);
    }
  } finally {
    // Releasing the lock lets undici tear the socket down rather than leaving it half-read.
    reader.releaseLock();
    if (!response.bodyUsed) await body.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parse(new TextDecoder().decode(merged), label);
}

function parse(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError(`${label} was not valid JSON`);
  }
}
