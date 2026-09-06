/** Cancel the underlying operation, not just the UI wait. Never retries a POST. */
export async function requestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
  ms = 25_000,
): Promise<T> {
  const controller = new AbortController();
  const relay = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", relay, { once: true });
  if (parent?.aborted) relay();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Request deadline exceeded", "TimeoutError"),
      ),
    ms,
  );
  try {
    controller.signal.throwIfAborted();
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", relay);
  }
}
