import { createHash } from "node:crypto";

import type { ProviderErrorCode as ExternalProviderErrorCode } from "../application/providers";

export type ZhihuSearchDiagnosticContext = Readonly<{
  requestId: string;
  queryFingerprint: string;
  queryLength: number;
  count: number;
  timeoutMs: number;
}>;

export type ZhihuSearchPayloadSummary = Readonly<{
  payloadType:
    | "undefined"
    | "null"
    | "array"
    | "object"
    | "string"
    | "number"
    | "boolean"
    | "other";
  topLevelKeys: readonly string[];
  dataKeys?: readonly string[];
  itemCount?: number;
  itemKeySets?: readonly string[];
  itemContentTypes?: readonly string[];
  itemAuthorityLevels?: readonly string[];
  businessCode?: number;
}>;

export type ZhihuSearchResponseSummary = Readonly<
  ZhihuSearchPayloadSummary & {
    httpStatus: number;
    responseOk: boolean;
    responseContentType: string | null;
    bodyLength: number;
    jsonStatus: "valid" | "empty" | "invalid" | "unreadable";
  }
>;

type ZhihuSearchDiagnosticEventBase = Readonly<
  ZhihuSearchDiagnosticContext & {
    startedAtMs: number;
    finishedAtMs?: number;
    durationMs?: number;
  }
>;

export type ZhihuSearchFailurePhase =
  | "timestamp"
  | "transport"
  | "http"
  | "envelope"
  | "business"
  | "data"
  | "normalization";

export type ZhihuSearchDiagnosticEvent =
  | (ZhihuSearchDiagnosticEventBase & {
      event: "zhihu_source_search_started";
    })
  | (ZhihuSearchDiagnosticEventBase & {
      event: "zhihu_source_search_response";
      response: ZhihuSearchResponseSummary;
    })
  | (ZhihuSearchDiagnosticEventBase & {
      event: "zhihu_source_search_succeeded";
      sourceCount: number;
    })
  | (ZhihuSearchDiagnosticEventBase & {
      event: "zhihu_source_search_failed";
      failureCode: ExternalProviderErrorCode;
      retryable: boolean;
      failurePhase: ZhihuSearchFailurePhase;
      response?: ZhihuSearchResponseSummary;
      validationIssueCodes?: readonly string[];
    });

export type ZhihuSearchDiagnosticLogger = (
  event: ZhihuSearchDiagnosticEvent,
) => void;

export function queryFingerprint(query: string): string {
  return createHash("sha256").update(query, "utf8").digest("hex").slice(0, 16);
}

const MAX_DIAGNOSTIC_KEYS = 32;
const MAX_DIAGNOSTIC_ITEMS = 32;
const MAX_DIAGNOSTIC_VALUES = 8;

function payloadType(value: unknown): ZhihuSearchPayloadSummary["payloadType"] {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object":
      return "object";
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "other";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function boundedSortedKeys(record: Record<string, unknown>): readonly string[] {
  return Object.keys(record).sort().slice(0, MAX_DIAGNOSTIC_KEYS);
}

function diagnosticValue(value: unknown): string {
  if (typeof value !== "string") {
    return value === null ? "null" : typeof value;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "<empty>";
  }
  return trimmed.length > 32 ? `${trimmed.slice(0, 29)}...` : trimmed;
}

function summarizeItemShapes(items: readonly unknown[]) {
  const itemKeySets = new Set<string>();
  const itemContentTypes = new Set<string>();
  const itemAuthorityLevels = new Set<string>();
  const sampleSize = Math.min(items.length, MAX_DIAGNOSTIC_ITEMS);

  for (let index = 0; index < sampleSize; index += 1) {
    const itemRecord = asRecord(items[index]);
    if (itemRecord) {
      itemKeySets.add(boundedSortedKeys(itemRecord).join(","));
    }
    itemContentTypes.add(diagnosticValue(itemRecord?.ContentType));
    itemAuthorityLevels.add(diagnosticValue(itemRecord?.AuthorityLevel));
  }

  return {
    itemKeySets: [...itemKeySets].sort().slice(0, MAX_DIAGNOSTIC_VALUES),
    itemContentTypes: [...itemContentTypes]
      .sort()
      .slice(0, MAX_DIAGNOSTIC_VALUES),
    itemAuthorityLevels: [...itemAuthorityLevels]
      .sort()
      .slice(0, MAX_DIAGNOSTIC_VALUES),
  };
}

export function summarizeZhihuSearchPayload(
  value: unknown,
): ZhihuSearchPayloadSummary {
  const record = asRecord(value);
  const data = asRecord(record?.Data);
  const items = data?.Items;
  const itemShapes = Array.isArray(items)
    ? summarizeItemShapes(items)
    : undefined;

  return {
    payloadType: payloadType(value),
    topLevelKeys: record ? boundedSortedKeys(record) : [],
    ...(data ? { dataKeys: boundedSortedKeys(data) } : {}),
    ...(Array.isArray(items)
      ? {
          itemCount: items.length,
          ...itemShapes,
        }
      : {}),
    ...(typeof record?.Code === "number" && Number.isInteger(record.Code)
      ? { businessCode: record.Code }
      : {}),
  };
}

export function emitZhihuSearchDiagnostic(
  logger: ZhihuSearchDiagnosticLogger | undefined,
  event: ZhihuSearchDiagnosticEvent,
): void {
  if (!logger) return;
  try {
    logger(event);
  } catch {
    // Diagnostics must never change the provider's business result.
  }
}

export function writeZhihuSearchDiagnostic(
  event: ZhihuSearchDiagnosticEvent,
): void {
  console.info(JSON.stringify(event));
}
