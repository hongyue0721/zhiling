import { acceptsEvent, eventStage, isTerminal, SseDecoder, type TaskEvent, type TaskSnapshot } from "./generation-protocol";
export class ProgressConnectionError extends Error {
  constructor(message: string, readonly status = 0) { super(message); this.name = "ProgressConnectionError"; }
}
export type FollowOptions = Readonly<{
  taskId: string; initialSequence: number; signal: AbortSignal;
  readSnapshot: (signal: AbortSignal) => Promise<TaskSnapshot>;
  onSnapshot: (snapshot: TaskSnapshot) => void;
  onEvent: (event: TaskEvent) => void;
  onConnection: (state: "live" | "reconnecting", attempt: number) => void;
  fetcher?: typeof fetch; maxReconnects?: number; idleMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}>;
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}
/** Reconnects the SAME task; never POSTs a new task. HTTP 200 alone does not reset the retry budget. */
export async function followGeneration(options: FollowOptions): Promise<void> {
  const { taskId, signal } = options;
  const fetcher = options.fetcher ?? fetch;
  let sequence = options.initialSequence;
  let reconnects = 0;
  while (!signal.aborted) {
    const connection = new AbortController();
    const abort = () => connection.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) connection.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => { clearTimeout(timer); timer = setTimeout(abort, options.idleMs ?? 45_000); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let terminal = false;
    let advanced = false;
    try {
      touch();
      const response = await fetcher(`/api/map-generations/${encodeURIComponent(taskId)}/events`, {
        headers: { Accept: "text/event-stream", "Last-Event-ID": String(sequence) },
        credentials: "include", cache: "no-store", signal: connection.signal,
      });
      if (!response.ok) throw new ProgressConnectionError("生成进度连接暂不可用", response.status);
      if (!response.body) throw new ProgressConnectionError("没有收到进度流");
      options.onConnection("live", reconnects);
      reader = response.body.getReader();
      const decoder = new SseDecoder();
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        for (const event of decoder.push(value)) {
          if (!acceptsEvent(event, taskId, sequence)) continue;
          advanced ||= event.sequence > sequence;
          sequence = Math.max(sequence, event.sequence);
          options.onEvent(event);
          if (isTerminal(event.type) || isTerminal(eventStage(event) ?? "")) { terminal = true; break; }
        }
        if (terminal) break;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ProgressConnectionError && [400, 401, 403, 404].includes(error.status)) throw error;
    } finally {
      clearTimeout(timer);
      connection.abort();
      signal.removeEventListener("abort", abort);
      if (reader) { try { await reader.cancel(); } catch { /* aborted stream */ } reader.releaseLock(); }
    }
    if (signal.aborted) return;
    // Canonical GET is necessary: terminal SSE does not guarantee a per-user relationship ID.
    try {
      const snapshot = await options.readSnapshot(signal);
      if (signal.aborted) return;
      if (snapshot.taskId !== taskId || snapshot.sequence < sequence) throw new ProgressConnectionError("任务快照尚未追上进度流");
      advanced ||= snapshot.sequence > sequence;
      sequence = snapshot.sequence;
      options.onSnapshot(snapshot);
      if (isTerminal(snapshot.status)) return;
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ProgressConnectionError && [401, 403, 404].includes(error.status)) throw error;
      // Preserve task identity; an unavailable snapshot is a connection failure, not generation failure.
    }
    reconnects = advanced ? 1 : reconnects + 1;
    if (reconnects > (options.maxReconnects ?? 6)) throw new ProgressConnectionError("进度连接暂时中断。任务可能仍在执行，请重新连接原任务。");
    options.onConnection("reconnecting", reconnects);
    await (options.sleep ?? abortableDelay)(Math.min(8_000, 700 * 2 ** (reconnects - 1)), signal);
  }
}
