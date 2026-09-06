/** One deadline covers headers AND the entire response body. No extra requests. */
export class WireTimeout extends Error {
  constructor() {
    super("Provider request exceeded its deadline");
    this.name = "WireTimeout";
  }
}

const bufferedBodies = new WeakMap<Response, string>();

export async function readWireText(response: Response): Promise<string> {
  const cached = bufferedBodies.get(response);
  if (cached !== undefined) {
    bufferedBodies.delete(response);
    return cached;
  }
  return response.text();
}

export async function fetchWireResponse(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Invalid deadline");
  }
  const controller = new AbortController();
  const parent = init.signal;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const cancel = (reason: unknown) => {
    controller.abort(reason);
    rejectAbort(reason);
  };
  const relay = () =>
    cancel(parent?.reason ?? new DOMException("Aborted", "AbortError"));
  const timer = setTimeout(() => cancel(new WireTimeout()), timeoutMs);
  parent?.addEventListener("abort", relay, { once: true });
  if (parent?.aborted) relay();
  const operation = async () => {
    controller.signal.throwIfAborted();
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const text = await response.text();
    controller.signal.throwIfAborted();
    bufferedBodies.set(response, text);
    return response;
  };
  try {
    // The race also releases the caller when an injected transport ignores abort.
    // Native fetch is actually cancelled by the same signal; late results are discarded.
    return await Promise.race([operation(), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", relay);
  }
}
