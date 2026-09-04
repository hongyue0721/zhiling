import type {
  GenerationDirectionCandidate,
  GenerationSourceCandidate,
} from "../domain/candidate";

export const MODEL_MAX_ATTEMPTS = 3 as const;

/**
 * Application-owned context budgets. These are prompt-size policies, not
 * limits advertised by Zhida or any other provider.
 */
export const MODEL_CONTEXT_BUDGETS = Object.freeze([
  {
    attempt: 1,
    targetSources: 16,
    maxExcerptChars: 320,
    targetSourceChars: 7_200,
  },
  {
    attempt: 2,
    targetSources: 12,
    maxExcerptChars: 220,
    targetSourceChars: 4_800,
  },
  {
    attempt: 3,
    targetSources: 8,
    maxExcerptChars: 140,
    targetSourceChars: 3_200,
  },
] as const);

type ContextBudgetTier = (typeof MODEL_CONTEXT_BUDGETS)[number];

export type GenerationDirectionSourceCoverage = Readonly<{
  directionId: string;
  sourceIds: readonly string[];
}>;

export type ModelContextBudget = Readonly<{
  strategy: "application_context_budget";
  attempt: 1 | 2 | 3;
  targetSources: number;
  maxExcerptChars: number;
  targetSourceChars: number;
  serializedChars: number;
  sources: readonly GenerationSourceCandidate[];
  directionCoverage: readonly GenerationDirectionSourceCoverage[];
}>;

export type CreateModelContextBudgetInput = Readonly<{
  attempt: number;
  directions: readonly GenerationDirectionCandidate[];
  sources: readonly GenerationSourceCandidate[];
  /** Sources already cited by a map must stay in every dependent call. */
  requiredSourceIds?: readonly string[];
  sourceIdsByDirection?: readonly GenerationDirectionSourceCoverage[];
}>;

function tierForAttempt(attempt: number): ContextBudgetTier {
  if (attempt <= 1) {
    return MODEL_CONTEXT_BUDGETS[0];
  }
  if (attempt === 2) {
    return MODEL_CONTEXT_BUDGETS[1];
  }
  return MODEL_CONTEXT_BUDGETS[2];
}

function ranking(source: GenerationSourceCandidate): number {
  return Number.isFinite(source.rankingScore) ? source.rankingScore : -Infinity;
}

function sourceOrder(
  sources: readonly GenerationSourceCandidate[],
): ReadonlyMap<string, number> {
  return new Map(sources.map((source, index) => [source.sourceId, index]));
}

function compareSources(
  left: GenerationSourceCandidate,
  right: GenerationSourceCandidate,
  order: ReadonlyMap<string, number>,
): number {
  const score = ranking(right) - ranking(left);
  if (score !== 0) {
    return score;
  }
  return (
    (order.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER)
  );
}

function compactSource(
  source: GenerationSourceCandidate,
  maxExcerptChars: number,
): GenerationSourceCandidate {
  const excerpt = source.excerpt.trim().slice(0, maxExcerptChars);
  return excerpt === source.excerpt ? source : { ...source, excerpt };
}

function promptProjection(source: GenerationSourceCandidate): Readonly<{
  sourceId: string;
  title: string;
  excerpt: string;
  authorName: string;
  contentType: GenerationSourceCandidate["contentType"];
  updatedAt: number;
  authorityLevel: GenerationSourceCandidate["authorityLevel"];
  rankingScore: number;
}> {
  return {
    sourceId: source.sourceId,
    title: source.title,
    excerpt: source.excerpt,
    authorName: source.authorName,
    contentType: source.contentType,
    updatedAt: source.updatedAt,
    authorityLevel: source.authorityLevel,
    rankingScore: source.rankingScore,
  };
}

function serializedSourceLength(source: GenerationSourceCandidate): number {
  return JSON.stringify(promptProjection(source)).length;
}

function uniqueKnownSourceIds(
  ids: readonly string[],
  known: ReadonlyMap<string, GenerationSourceCandidate>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * Selects a deterministic, direction-balanced source set for a model call.
 * Required map citations take precedence over the tier count so dependent
 * stages can never be asked to invent or lose an existing source relation.
 */
export function createModelContextBudget({
  attempt,
  directions,
  sources,
  requiredSourceIds = [],
  sourceIdsByDirection = [],
}: CreateModelContextBudgetInput): ModelContextBudget {
  const tier = tierForAttempt(attempt);
  const normalizedAttempt = tier.attempt as 1 | 2 | 3;
  const byId = new Map(sources.map((source) => [source.sourceId, source]));
  const order = sourceOrder(sources);
  const groups = new Map(
    sourceIdsByDirection.map((coverage) => [
      coverage.directionId,
      coverage.sourceIds,
    ]),
  );
  const selectedIds: string[] = [];
  const selected = new Set<string>();

  const add = (sourceId: string): void => {
    if (selected.has(sourceId) || !byId.has(sourceId)) {
      return;
    }
    selected.add(sourceId);
    selectedIds.push(sourceId);
  };

  const requiredIds = uniqueKnownSourceIds(requiredSourceIds, byId);
  const mandatoryIds = new Set(requiredIds);
  for (const sourceId of requiredIds) {
    add(sourceId);
  }

  const directionCandidates = directions.map((direction) =>
    (groups.get(direction.directionId) ?? [])
      .map((sourceId) => byId.get(sourceId))
      .filter(
        (source): source is GenerationSourceCandidate => source !== undefined,
      )
      .sort((left, right) => compareSources(left, right, order)),
  );
  for (const candidates of directionCandidates) {
    if (candidates[0]) {
      mandatoryIds.add(candidates[0].sourceId);
      add(candidates[0].sourceId);
    }
  }

  // Round-robin ranked sources so a large direction cannot consume the tier.
  const positions = directionCandidates.map(() => 0);
  let addedInRound = true;
  while (selectedIds.length < tier.targetSources && addedInRound) {
    addedInRound = false;
    for (const [index, candidates] of directionCandidates.entries()) {
      if (selectedIds.length >= tier.targetSources) {
        break;
      }
      while (positions[index]! < candidates.length) {
        const source = candidates[positions[index]!];
        positions[index] = positions[index]! + 1;
        if (source && !selected.has(source.sourceId)) {
          add(source.sourceId);
          addedInRound = true;
          break;
        }
      }
    }
  }

  const ranked = [...sources].sort((left, right) =>
    compareSources(left, right, order),
  );
  for (const source of ranked) {
    if (selectedIds.length >= tier.targetSources) {
      break;
    }
    add(source.sourceId);
  }

  const compacted = selectedIds.map((sourceId) =>
    compactSource(byId.get(sourceId)!, tier.maxExcerptChars),
  );
  const bounded: GenerationSourceCandidate[] = [];
  let serializedChars = 2;
  for (const source of compacted) {
    const candidateChars =
      serializedChars +
      (bounded.length > 0 ? 1 : 0) +
      serializedSourceLength(source);
    // Required citations and minimum direction coverage override prompt-size
    // targets; silently dropping a known relationship would corrupt the task.
    if (
      bounded.length > 0 &&
      candidateChars > tier.targetSourceChars &&
      !mandatoryIds.has(source.sourceId)
    ) {
      continue;
    }
    bounded.push(source);
    serializedChars = candidateChars;
  }

  const selectedByDirection = new Set(bounded.map((source) => source.sourceId));
  const directionCoverage = directions.map((direction) => ({
    directionId: direction.directionId,
    sourceIds: (groups.get(direction.directionId) ?? []).filter((sourceId) =>
      selectedByDirection.has(sourceId),
    ),
  }));

  return {
    strategy: "application_context_budget",
    attempt: normalizedAttempt,
    targetSources: tier.targetSources,
    maxExcerptChars: tier.maxExcerptChars,
    targetSourceChars: tier.targetSourceChars,
    serializedChars,
    sources: bounded,
    directionCoverage,
  };
}
