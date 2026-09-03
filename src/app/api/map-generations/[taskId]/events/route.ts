import { generation, identity } from "@/bootstrap/server";
import type {
  GenerationEvent,
  GenerationEventsResult,
} from "@/modules/map-generation/public/server";

import {
  encodeSseEvent,
  encodeSseKeepAlive,
  isTerminalEventType,
  mapGenerationError,
  notFoundError,
  safeEventData,
  snapshotEvent,
  type SseEventEnvelope,
  validationError,
} from "../../_shared";

export const dynamic = "force-dynamic";

const pollIntervalMs = 1_000;
const keepAliveIntervalMs = 15_000;

type RouteContext = Readonly<{
  params: Promise<{ taskId: string }>;
}>;

function parseLastEventId(request: Request): number | Response {
  const value = request.headers.get("last-event-id");
  if (value === null || value.trim() === "") {
    return 0;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return validationError([
      {
        path: ["headers", "last-event-id"],
        code: "invalid_format",
        message: "Last-Event-ID 必须是非负整数",
      },
    ]);
  }

  const sequence = Number(normalized);
  if (!Number.isSafeInteger(sequence)) {
    return validationError([
      {
        path: ["headers", "last-event-id"],
        code: "out_of_range",
        message: "Last-Event-ID 超出可支持范围",
      },
    ]);
  }
  return sequence;
}

function toEventEnvelope(event: GenerationEvent): SseEventEnvelope {
  return {
    protocolVersion: "1",
    taskId: event.taskId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    data: safeEventData(event.data),
  };
}

function isTerminalEvent(event: GenerationEvent): boolean {
  return isTerminalEventType(event.type);
}

function eventsInSequenceOrder(
  events: readonly GenerationEvent[],
  taskId: string,
  afterSequence: number,
): GenerationEvent[] {
  return events
    .filter(
      (event) => event.taskId === taskId && event.sequence > afterSequence,
    )
    .slice()
    .sort((left, right) => left.sequence - right.sequence);
}

function waitFor(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(true);
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(false);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function streamHeaders(): Headers {
  return new Headers({
    "cache-control": "private, no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
  });
}

function createEventStream(
  request: Request,
  userId: string,
  taskId: string,
  afterSequence: number,
  initialResult: GenerationEventsResult,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;
  let cursor = afterSequence;
  let fallbackSequence: number | null = null;
  let lastKeepAliveAt = Date.now();
  let removeAbortListener: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        removeAbortListener?.();
        controller.close();
      };

      const fail = () => {
        if (closed) {
          return;
        }
        closed = true;
        removeAbortListener?.();
        controller.close();
      };

      const onAbort = () => close();
      request.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () =>
        request.signal.removeEventListener("abort", onAbort);

      void (async () => {
        let result: GenerationEventsResult | null = initialResult;

        try {
          while (!closed && !request.signal.aborted && result !== null) {
            let reachedTerminal = false;

            if (result.kind === "snapshot") {
              const fallback = snapshotEvent(result.snapshot);
              if (fallbackSequence !== fallback.sequence) {
                controller.enqueue(encoder.encode(encodeSseEvent(fallback)));
                fallbackSequence = fallback.sequence;
              }
              cursor = Math.max(cursor, fallback.sequence);
              reachedTerminal =
                result.snapshot.status === "succeeded" ||
                result.snapshot.status === "failed";
            }

            const events = eventsInSequenceOrder(result.events, taskId, cursor);
            for (const event of events) {
              const envelope = toEventEnvelope(event);
              controller.enqueue(encoder.encode(encodeSseEvent(envelope)));
              cursor = event.sequence;
              reachedTerminal ||= isTerminalEvent(event);
            }

            if (reachedTerminal) {
              close();
              return;
            }

            const elapsed = Date.now() - lastKeepAliveAt;
            if (elapsed >= keepAliveIntervalMs) {
              controller.enqueue(encoder.encode(encodeSseKeepAlive()));
              lastKeepAliveAt = Date.now();
            }

            if (!(await waitFor(pollIntervalMs, request.signal))) {
              close();
              return;
            }
            if (closed || request.signal.aborted) {
              close();
              return;
            }

            result = await generation.readEvents(userId, taskId, cursor);
          }

          close();
        } catch {
          fail();
        }
      })();
    },
    cancel() {
      closed = true;
      removeAbortListener?.();
    },
  });

  return stream;
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const formalIdentity = await identity.require(request.headers);
    const parsedLastEventId = parseLastEventId(request);
    if (parsedLastEventId instanceof Response) {
      return parsedLastEventId;
    }

    const { taskId } = await context.params;
    const result = await generation.readEvents(
      formalIdentity.userId,
      taskId,
      parsedLastEventId,
    );
    if (!result) {
      return notFoundError();
    }
    if (
      result.kind === "snapshot" &&
      parsedLastEventId > result.snapshot.sequence
    ) {
      return validationError([
        {
          path: ["headers", "last-event-id"],
          code: "out_of_range",
          message: "Last-Event-ID 不能晚于任务当前序列",
        },
      ]);
    }

    return new Response(
      createEventStream(
        request,
        formalIdentity.userId,
        taskId,
        parsedLastEventId,
        result,
      ),
      { headers: streamHeaders() },
    );
  } catch (error) {
    return mapGenerationError(error);
  }
}
