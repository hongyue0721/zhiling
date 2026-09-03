import { z } from "zod";

import {
  ProviderRequestError as ExternalProviderError,
  type ProviderEnvironment as ExternalProviderEnvironment,
  type ProviderErrorCode as ExternalProviderErrorCode,
  type ProviderSource as NormalizedSource,
  type ProviderSourceSearchAccess as SourceSearchAccess,
  type ProviderSourceSearchInput as SourceSearchInput,
  type ProviderSourceSearchResult as SourceSearchResult,
} from "../application/providers";
import {
  createProviderError,
  effectiveTimeout,
  fetchWithTimeout,
  mapHttpStatus,
  readJson,
  RequestTimeout,
  retryAfterMilliseconds,
  timestampSeconds,
  type Clock,
} from "./provider-http";

const SOURCE_SEARCH_URL =
  "https://developer.zhihu.com/api/v1/content/zhihu_search";

const timeoutInputSchema = z.number().int().min(1).max(600_000);
const requestIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);

const searchInputSchema = z.strictObject({
  query: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  count: z.number().int(),
  requestId: requestIdSchema,
  timeoutMs: timeoutInputSchema,
});

const sourceCommentSchema = z.strictObject({
  Content: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
});

const sourceItemSchema = z.strictObject({
  Title: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  ContentType: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  ContentID: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  ContentText: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  Url: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  CommentCount: z.number().int().nonnegative(),
  VoteUpCount: z.number().int().nonnegative(),
  AuthorName: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  AuthorAvatar: z.string(),
  AuthorBadge: z.string(),
  AuthorBadgeText: z.string(),
  EditTime: z.number().int().nonnegative(),
  CommentInfoList: z.array(sourceCommentSchema).optional(),
  AuthorityLevel: z.string().min(1),
  RankingScore: z.number().finite(),
});

const sourceDataSchema = z.strictObject({
  HasMore: z.boolean(),
  SearchHashId: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0),
  Items: z.array(sourceItemSchema),
  EmptyReason: z.string().optional(),
});

const sourceResponseSchema = z.strictObject({
  Code: z.number().int(),
  Message: z.string(),
  Data: z.unknown(),
});

type SourceProviderItem = z.infer<typeof sourceItemSchema>;

const sourceContentTypeMap: Readonly<
  Record<string, NormalizedSource["contentType"]>
> = Object.freeze({
  Answer: "answer",
  Article: "article",
  Question: "question",
});

const sourceAuthorityLevelMap: Readonly<
  Record<string, NormalizedSource["authorityLevel"]>
> = Object.freeze({
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "very_high",
});

function responseBusinessCode(value: unknown): number | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("Code" in value) ||
    typeof value.Code !== "number" ||
    !Number.isInteger(value.Code)
  ) {
    return undefined;
  }
  return value.Code;
}

function mapBusinessCode(
  code: number | undefined,
): ExternalProviderErrorCode | undefined {
  switch (code) {
    case 10001:
      return "invalid_request";
    case 20001:
      return "authentication_failed";
    case 30001:
      return "rate_limited";
    case 30002:
      return "quota_exhausted";
    case 90001:
      return "temporarily_unavailable";
    default:
      return undefined;
  }
}

function canonicalizeZhihuUrl(rawUrl: string): string {
  if (rawUrl !== rawUrl.trim()) {
    throw new Error("invalid source url");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("invalid source url");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    (hostname !== "zhihu.com" && !hostname.endsWith(".zhihu.com")) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    throw new Error("invalid source url");
  }

  parsed.hostname = hostname;
  return parsed.toString();
}

function sourceIdForContent(
  contentType: NormalizedSource["contentType"],
  contentId: string,
): string {
  return `zhihu_${contentType}_${contentId.trim()}`;
}

function normalizeSource(item: SourceProviderItem): NormalizedSource {
  const url = canonicalizeZhihuUrl(item.Url);
  const contentType = sourceContentTypeMap[item.ContentType];
  const authorityLevel = sourceAuthorityLevelMap[item.AuthorityLevel];
  if (!contentType || !authorityLevel) {
    throw new Error("unknown source enum");
  }

  return {
    sourceId: sourceIdForContent(contentType, item.ContentID),
    title: item.Title.trim(),
    excerpt: item.ContentText.trim(),
    url,
    authorName: item.AuthorName.trim(),
    contentType,
    updatedAt: item.EditTime,
    authorityLevel,
    rankingScore: item.RankingScore,
  };
}

function validateSearchInput(input: SourceSearchInput): SourceSearchInput {
  const result = searchInputSchema.safeParse(input);
  if (!result.success) {
    throw createProviderError("source", "invalid_request");
  }
  return result.data;
}

export class ZhihuSourceSearch implements SourceSearchAccess {
  constructor(
    private readonly environment: ExternalProviderEnvironment,
    private readonly fetcher: typeof fetch,
    private readonly clock: Clock,
  ) {}

  async search(input: SourceSearchInput): Promise<SourceSearchResult> {
    const validInput = validateSearchInput(input);
    let timestamp: string;
    try {
      timestamp = timestampSeconds(this.clock, "source");
    } catch (error) {
      if (error instanceof ExternalProviderError) {
        throw new ExternalProviderError({
          ...error,
          provider: "source",
        });
      }
      throw createProviderError("source", "protocol_error");
    }

    const url = new URL(SOURCE_SEARCH_URL);
    url.searchParams.set("Query", validInput.query.trim());
    url.searchParams.set(
      "Count",
      String(validInput.count <= 0 ? 10 : Math.min(validInput.count, 10)),
    );

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetcher,
        url.toString(),
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.environment.accessSecret}`,
            "X-Request-Timestamp": timestamp,
            "Content-Type": "application/json",
          },
        },
        effectiveTimeout(
          validInput.timeoutMs,
          this.environment.sourceTimeoutMs,
          "source",
        ),
      );
    } catch (error) {
      if (error instanceof RequestTimeout) {
        throw createProviderError("source", "timeout");
      }
      throw createProviderError("source", "temporarily_unavailable");
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const code =
        mapHttpStatus(response.status) ??
        mapBusinessCode(responseBusinessCode(payload)) ??
        (response.status >= 400 ? "invalid_request" : "protocol_error");
      throw createProviderError(
        "source",
        code,
        retryAfterMilliseconds(response),
      );
    }

    const parsedResponse = sourceResponseSchema.safeParse(payload);
    if (!parsedResponse.success) {
      throw createProviderError("source", "protocol_error");
    }
    if (parsedResponse.data.Code !== 0) {
      throw createProviderError(
        "source",
        mapBusinessCode(parsedResponse.data.Code) ?? "protocol_error",
      );
    }

    const parsedData = sourceDataSchema.safeParse(parsedResponse.data.Data);
    if (!parsedData.success) {
      throw createProviderError("source", "protocol_error");
    }

    try {
      const seen = new Set<string>();
      const sources: NormalizedSource[] = [];
      for (const item of parsedData.data.Items) {
        const source = normalizeSource(item);
        if (seen.has(source.sourceId)) {
          continue;
        }
        seen.add(source.sourceId);
        sources.push(source);
      }
      return {
        searchId: parsedData.data.SearchHashId,
        sources,
      };
    } catch {
      throw createProviderError("source", "protocol_error");
    }
  }
}
