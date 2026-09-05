/** Browser-side projection of the existing /api/map-generations contract. */
export type TaskResult = Readonly<{ mapId: string; versionId: string; learningRelationshipId: string }>;
export type TaskFailure = Readonly<{ code: string; retryable: boolean }>;
export type TaskSnapshot = Readonly<{
  taskId: string; status: string; stage: string; sequence: number;
  createdAt: string; updatedAt: string; deadlineAt: string;
  result: TaskResult | null; failure: TaskFailure | null;
}>;
export type TaskEvent = Readonly<{
  protocolVersion: "1"; taskId: string; sequence: number;
  type: "snapshot" | "progress" | "succeeded" | "failed";
  occurredAt: string; data: Readonly<Record<string, unknown>>;
}>;
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
export function readResult(value: unknown): TaskResult | null {
  const r = record(value);
  return r && text(r.mapId) && text(r.versionId) && text(r.learningRelationshipId)
    ? { mapId: text(r.mapId), versionId: text(r.versionId), learningRelationshipId: text(r.learningRelationshipId) } : null;
}
export function readSnapshot(value: unknown): TaskSnapshot {
  const r = record(value);
  if (!r || !text(r.taskId) || !text(r.status) || !Number.isSafeInteger(r.sequence) || Number(r.sequence) < 0) {
    throw new Error("任务快照不完整，请重新连接进度。");
  }
  const f = record(r.failure);
  return {
    taskId: text(r.taskId), status: text(r.status), stage: text(r.stage) || text(r.status), sequence: Number(r.sequence),
    createdAt: text(r.createdAt), updatedAt: text(r.updatedAt), deadlineAt: text(r.deadlineAt),
    result: readResult(r.result),
    failure: f && text(f.code) && typeof f.retryable === "boolean" ? { code: text(f.code), retryable: f.retryable } : null,
  };
}
export function readRequest(value: unknown): { reuse: string; snapshot: TaskSnapshot } {
  const r = record(value);
  if (!r) throw new Error("没有收到生成任务。");
  return { reuse: text(r.reuse), snapshot: readSnapshot(r.snapshot) };
}
export function parseSseBlock(block: string): TaskEvent | null {
  const data = block.replace(/^\uFEFF/, "").split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, "")).join("\n");
  if (!data) return null;
  try {
    const e = record(JSON.parse(data));
    if (!e || e.protocolVersion !== "1" || !text(e.taskId) || !Number.isSafeInteger(e.sequence) || Number(e.sequence) < 0 || !record(e.data)) return null;
    if (!["snapshot", "progress", "succeeded", "failed"].includes(text(e.type))) return null;
    return e as unknown as TaskEvent;
  } catch { return null; }
}
/** Handles UTF-8, split CRLF boundaries and multiple data lines. Incomplete EOF frames are discarded. */
export class SseDecoder {
  private buffer = "";
  private decoder = new TextDecoder();
  push(chunk: Uint8Array): TaskEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() ?? "";
    return blocks.map(parseSseBlock).filter((e): e is TaskEvent => e !== null);
  }
}
export function eventStage(event: TaskEvent): string | null {
  return text(event.data.status) || text(event.data.stage) || null;
}
export function isTerminal(status: string): boolean { return status === "succeeded" || status === "failed"; }
export function acceptsEvent(event: TaskEvent, taskId: string, sequence: number): boolean {
  return event.taskId === taskId && (event.sequence > sequence || (event.type === "snapshot" && event.sequence === sequence));
}
