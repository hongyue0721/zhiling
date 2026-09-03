import {
  assertNoModelUrl,
  type GenerationCandidate,
  type GenerationDirectionCandidate,
  type GenerationMapCandidate,
  type GenerationSourceCandidate,
  type GenerationViewpointCandidate,
  validateGenerationCandidate,
} from "../domain/candidate";
import { normalizeGenerationTopic } from "../domain/identity";
import {
  GENERATION_DEADLINE_MS,
  GENERATION_HEARTBEAT_MS,
  LOCAL_OPERATION_TIMEOUT_MS,
  MAX_EXTERNAL_RETRIES,
} from "../domain/state-machine";
import {
  GenerationLeaseLostError,
  GenerationTaskFailure,
  type GenerationCache,
  type GenerationExecutionPort,
  type GenerationHeartbeatScheduler,
  type GenerationProviderBundle,
  type GenerationSleeper,
  type GenerationTask,
  type GenerationPublicationPort,
} from "./ports";

export const EXTERNAL_REQUEST_TIMEOUT_MS = 20_000;
export const SEARCH_RESULTS_PER_DIRECTION = 8;
export const SUPPLEMENT_RESULTS_PER_NODE = 6;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function externalProviderOf(error: unknown): "source" | "model" | null {
  const object = asRecord(error);
  return object?.provider === "source" || object?.provider === "model"
    ? object.provider
    : null;
}

function externalCode(error: unknown): string | null {
  const object = asRecord(error);
  return typeof object?.code === "string" ? object.code : null;
}

function isRetryableExternalError(error: unknown): boolean {
  const object = asRecord(error);
  if (typeof object?.retryable === "boolean") {
    return object.retryable;
  }
  return ["temporarily_unavailable", "timeout", "rate_limited"].includes(
    externalCode(error) ?? "",
  );
}
function externalRetryAfter(error: unknown): number | undefined {
  const value = asRecord(error)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(value, GENERATION_DEADLINE_MS)
    : undefined;
}

function mapExternalFailure(
  error: unknown,
  provider: "source" | "model",
): GenerationTaskFailure {
  const knownProvider = externalProviderOf(error) ?? provider;
  const category =
    knownProvider === "source"
      ? "source_unavailable"
      : externalCode(error) === "protocol_error"
        ? "candidate_invalid"
        : "model_unavailable";
  return new GenerationTaskFailure(
    category,
    isRetryableExternalError(error),
    category,
    externalRetryAfter(error),
  );
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export class MapGenerationWorker {
  constructor(
    private readonly execution: GenerationExecutionPort,
    private readonly publication: GenerationPublicationPort,
    private readonly providers: GenerationProviderBundle,
    private readonly now: () => Date,
    private readonly sleep: GenerationSleeper,
    private readonly scheduleHeartbeat: GenerationHeartbeatScheduler,
  ) {}

  async runOnce(workerId: string): Promise<boolean> {
    const task = await this.execution.claimTask(workerId);
    if (!task) {
      return false;
    }
    let taskError: unknown = null;
    let stopHeartbeat: (() => Promise<void>) | null = null;
    try {
      stopHeartbeat = this.startLeaseHeartbeat(task.id, workerId);
      await this.runTask(task, workerId);
    } catch (error) {
      taskError = error;
    } finally {
      if (stopHeartbeat) {
        try {
          await stopHeartbeat();
        } catch (error) {
          if (taskError === null) {
            taskError = error;
          }
        }
      }
    }
    if (taskError instanceof GenerationLeaseLostError) {
      return true;
    }
    if (taskError !== null) {
      const failure =
        taskError instanceof GenerationTaskFailure
          ? taskError
          : new GenerationTaskFailure("internal_failure", false);
      try {
        await this.execution.failTask(task.id, workerId, failure);
      } catch (failureError) {
        if (!(failureError instanceof GenerationLeaseLostError)) {
          throw failureError;
        }
      }
    }
    return true;
  }

  private startLeaseHeartbeat(
    taskId: string,
    workerId: string,
  ): () => Promise<void> {
    let stopped = false;
    let inFlight: Promise<void> | null = null;
    let failure: unknown = null;
    const tick = () => {
      if (stopped || inFlight || failure) {
        return;
      }
      inFlight = this.execution
        .renewLease(taskId, workerId)
        .catch((error: unknown) => {
          failure = error;
        })
        .finally(() => {
          inFlight = null;
        });
    };
    const cancel = this.scheduleHeartbeat(tick, GENERATION_HEARTBEAT_MS);
    return async () => {
      stopped = true;
      cancel();
      const pending = inFlight;
      if (pending) {
        await pending;
      }
      if (failure !== null) {
        throw failure;
      }
    };
  }

  private async runTask(task: GenerationTask, workerId: string): Promise<void> {
    let status = task.status;
    const checkpoints = await this.execution.getCheckpoints(task.id);
    const stageOutputs = new Map<string, unknown>(
      [...checkpoints].map(([stage, checkpoint]) => [stage, checkpoint.output]),
    );
    const output = <T>(stage: GenerationTask["stage"]): T | null => {
      const value = stageOutputs.get(stage);
      return value === null || value === undefined ? null : (value as T);
    };
    while (status !== "succeeded" && status !== "failed") {
      this.assertDeadline(task);
      if (status === "queued") {
        await this.execution.completeStage(
          task.id,
          workerId,
          "queued",
          "normalizing",
          "queued",
          { topic: task.topic },
          { accepted: true },
        );
        stageOutputs.set("queued", { accepted: true });
        status = "normalizing";
        continue;
      }
      if (status === "normalizing") {
        const identity = {
          normalizedTopic: normalizeGenerationTopic(task.topic),
          pipelineVersion: task.pipelineVersion,
          sourceAdapterVersion: task.sourceAdapterVersion,
          modelAdapterVersion: task.modelAdapterVersion,
        };
        await this.execution.completeStage(
          task.id,
          workerId,
          "normalizing",
          "cache_lookup",
          "normalizing",
          { topic: task.topic },
          identity,
        );
        stageOutputs.set("normalizing", identity);
        status = "cache_lookup";
        continue;
      }
      if (status === "cache_lookup") {
        const cache = await this.findCache(task);
        if (cache) {
          await this.publication.completeCachedTask(task.id, workerId, cache);
          return;
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "cache_lookup",
          "planning",
          "cache_lookup",
          { identity: task.normalizedTopic },
          { hit: false },
        );
        stageOutputs.set("cache_lookup", { hit: false });
        status = "planning";
        continue;
      }
      if (status === "planning") {
        const planned = await this.callModel(
          task,
          workerId,
          "planning",
          "planning",
          { topic: task.topic },
          () =>
            this.providers.structuredModel.planDirections({
              topic: task.topic,
              requestId: `${task.id}:planning`,
              timeoutMs: this.externalTimeout(task),
            }),
        );
        const plannedRecord = asRecord(planned);
        const directions = plannedRecord?.directions;
        if (
          !isArray(directions) ||
          directions.length < 3 ||
          directions.length > 4 ||
          directions.some((direction) => {
            const record = asRecord(direction);
            return (
              !record ||
              typeof record.directionId !== "string" ||
              typeof record.searchQuery !== "string"
            );
          })
        ) {
          throw new GenerationTaskFailure("candidate_invalid", false);
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "planning",
          "searching",
          "planning",
          { topic: task.topic },
          { directions },
        );
        stageOutputs.set("planning", { directions });
        status = "searching";
        continue;
      }
      if (status === "searching") {
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        if (!planned || !isArray(planned.directions)) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const sources = await this.searchDirections(
          task,
          workerId,
          planned.directions,
        );
        if (sources.length === 0) {
          throw new GenerationTaskFailure("source_insufficient", false);
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "searching",
          "structuring",
          "searching",
          { directions: planned.directions },
          { sources },
        );
        stageOutputs.set("searching", { sources });
        status = "structuring";
        continue;
      }
      if (status === "structuring") {
        const planned = output<{
          directions: readonly GenerationDirectionCandidate[];
        }>("planning");
        const searched = output<{
          sources: readonly GenerationSourceCandidate[];
        }>("searching");
        if (!planned || !searched) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const structured = await this.callModel(
          task,
          workerId,
          "structuring",
          "structuring",
          { directions: planned.directions, sources: searched.sources },
          () =>
            this.providers.structuredModel.structureMap({
              topic: task.topic,
              directions: planned.directions,
              sources: searched.sources,
              requestId: `${task.id}:structuring`,
              timeoutMs: this.externalTimeout(task),
            }),
        );
        assertNoModelUrl(structured, "structuring");
        const structuredRecord = asRecord(structured);
        const structuredNodes = structuredRecord?.nodes;
        const structuredPrerequisites = structuredRecord?.prerequisites;
        if (
          !structuredRecord ||
          !isArray(structuredNodes) ||
          !isArray(structuredPrerequisites) ||
          structuredNodes.some((node) => {
            const record = asRecord(node);
            return !record || !isArray(record.sourceIds);
          })
        ) {
          throw new GenerationTaskFailure("candidate_invalid", false);
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "structuring",
          "supplementing",
          "structuring",
          { directions: planned.directions, sources: searched.sources },
          structured,
        );
        stageOutputs.set("structuring", structured);
        status = "supplementing";
        continue;
      }
      if (status === "supplementing") {
        const structured = output<GenerationMapCandidate>("structuring");
        const searched = output<{
          sources: readonly GenerationSourceCandidate[];
        }>("searching");
        if (!structured || !searched) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const supplemented = await this.supplementMap(
          task,
          workerId,
          structured,
          searched.sources,
        );
        await this.execution.completeStage(
          task.id,
          workerId,
          "supplementing",
          "extracting",
          "supplementing",
          { map: structured, sources: searched.sources },
          supplemented,
        );
        stageOutputs.set("supplementing", supplemented);
        status = "extracting";
        continue;
      }
      if (status === "extracting") {
        const map = output<GenerationMapCandidate>("supplementing");
        const searched = output<{
          sources: readonly GenerationSourceCandidate[];
        }>("searching");
        const supplemented = output<{
          map: GenerationMapCandidate;
          sources: readonly GenerationSourceCandidate[];
        }>("supplementing");
        const effectiveMap = supplemented?.map ?? map;
        const sources = supplemented?.sources ?? searched?.sources;
        if (!effectiveMap || !sources) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const extracted = await this.callModel(
          task,
          workerId,
          "extracting",
          "extracting",
          { map: effectiveMap, sources },
          () =>
            this.providers.structuredModel.extractViewpoints({
              topic: task.topic,
              map: effectiveMap,
              sources,
              requestId: `${task.id}:extracting`,
              timeoutMs: this.externalTimeout(task),
            }),
        );
        assertNoModelUrl(extracted, "extracting");
        if (
          !asRecord(extracted) ||
          !isArray((extracted as { viewpoints?: unknown }).viewpoints)
        ) {
          throw new GenerationTaskFailure("candidate_invalid", false);
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "extracting",
          "assessing",
          "extracting",
          { map: effectiveMap, sources },
          {
            map: effectiveMap,
            sources,
            viewpoints: (extracted as { viewpoints: unknown }).viewpoints,
          },
        );
        const extractedViewpoints = (extracted as { viewpoints: unknown })
          .viewpoints;
        stageOutputs.set("extracting", {
          map: effectiveMap,
          sources,
          viewpoints: extractedViewpoints,
        });
        status = "assessing";
        continue;
      }
      if (status === "assessing") {
        const extracted = output<{
          map: GenerationMapCandidate;
          sources: readonly GenerationSourceCandidate[];
          viewpoints: readonly GenerationViewpointCandidate[];
        }>("extracting");
        if (!extracted) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const assessed = await this.callModel(
          task,
          workerId,
          "assessing",
          "assessing",
          extracted,
          () =>
            this.providers.structuredModel.generateAssessments({
              topic: task.topic,
              map: { ...extracted.map, viewpoints: extracted.viewpoints },
              sources: extracted.sources,
              requestId: `${task.id}:assessing`,
              timeoutMs: this.externalTimeout(task),
            }),
        );
        assertNoModelUrl(assessed, "assessing");
        if (
          !asRecord(assessed) ||
          !isArray((assessed as { questions?: unknown }).questions)
        ) {
          throw new GenerationTaskFailure("candidate_invalid", false);
        }
        await this.execution.completeStage(
          task.id,
          workerId,
          "assessing",
          "validating",
          "assessing",
          extracted,
          {
            directions:
              output<{ directions: readonly GenerationDirectionCandidate[] }>(
                "planning",
              )?.directions ?? [],
            map: extracted.map,
            viewpoints: extracted.viewpoints,
            questions: (assessed as { questions: unknown }).questions,
            sources: extracted.sources,
          },
        );
        stageOutputs.set("assessing", {
          directions:
            output<{ directions: readonly GenerationDirectionCandidate[] }>(
              "planning",
            )?.directions ?? [],
          map: extracted.map,
          viewpoints: extracted.viewpoints,
          questions: (assessed as { questions: unknown }).questions,
          sources: extracted.sources,
        });
        status = "validating";
        continue;
      }
      if (status === "validating") {
        const candidate = output<GenerationCandidate>("assessing");
        if (!candidate) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        const validated = await this.validateLocally(candidate);
        stageOutputs.set("validating", validated);
        await this.execution.completeStage(
          task.id,
          workerId,
          "validating",
          "publishing",
          "validating",
          candidate,
          validated,
        );
        status = "publishing";
        continue;
      }
      if (status === "publishing") {
        const candidate = output<GenerationCandidate>("validating");
        if (!candidate) {
          throw new GenerationTaskFailure("internal_failure", false);
        }
        await this.publication.publishCandidate(task.id, workerId, candidate);
        return;
      }
      throw new GenerationTaskFailure("internal_failure", false);
    }
  }

  private assertDeadline(task: GenerationTask): void {
    if (this.now().getTime() >= task.deadlineAt.getTime()) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
  }

  private externalTimeout(task: GenerationTask): number {
    const remaining = task.deadlineAt.getTime() - this.now().getTime();
    if (remaining <= 0) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
    return Math.max(1, Math.min(EXTERNAL_REQUEST_TIMEOUT_MS, remaining));
  }

  private async callModel<T>(
    task: GenerationTask,
    workerId: string,
    stage: GenerationTask["stage"],
    operationKey: string,
    input: unknown,
    call: () => Promise<T>,
  ): Promise<T> {
    return this.callExternal(
      task,
      workerId,
      stage,
      operationKey,
      input,
      "model",
      call,
    );
  }

  private async callSource<T>(
    task: GenerationTask,
    workerId: string,
    stage: GenerationTask["stage"],
    operationKey: string,
    input: unknown,
    call: () => Promise<T>,
  ): Promise<T> {
    return this.callExternal(
      task,
      workerId,
      stage,
      operationKey,
      input,
      "source",
      call,
    );
  }

  private async callExternal<T>(
    task: GenerationTask,
    workerId: string,
    stage: GenerationTask["stage"],
    operationKey: string,
    input: unknown,
    provider: "source" | "model",
    call: () => Promise<T>,
  ): Promise<T> {
    for (;;) {
      const attemptCount = await this.execution.recordAttempt(
        task.id,
        workerId,
        stage,
        operationKey,
        input,
      );
      if (attemptCount > MAX_EXTERNAL_RETRIES + 1) {
        throw new GenerationTaskFailure(
          provider === "source" ? "source_unavailable" : "model_unavailable",
          true,
        );
      }
      try {
        const result = await withTimeout(
          call(),
          this.externalTimeout(task),
          () =>
            new GenerationTaskFailure(
              provider === "source"
                ? "source_unavailable"
                : "model_unavailable",
              true,
            ),
        );
        await this.execution.resetAttempt(
          task.id,
          workerId,
          stage,
          operationKey,
        );
        return result;
      } catch (error) {
        if (error instanceof GenerationTaskFailure && !error.retryable) {
          throw error;
        }
        const failure =
          error instanceof GenerationTaskFailure
            ? error
            : mapExternalFailure(error, provider);
        if (!failure.retryable || attemptCount >= MAX_EXTERNAL_RETRIES + 1) {
          throw failure;
        }
        const exponentialBackoff = 250 * 2 ** (attemptCount - 1);
        const delay = Math.max(exponentialBackoff, failure.retryAfterMs ?? 0);
        const remaining = task.deadlineAt.getTime() - this.now().getTime();
        if (remaining <= delay) {
          throw new GenerationTaskFailure("generation_timeout", false);
        }
        await this.execution.renewLease(task.id, workerId);
        await this.sleep(delay);
      }
    }
  }

  private async findCache(
    task: GenerationTask,
  ): Promise<GenerationCache | null> {
    return this.execution.findReusableCache({
      normalizedTopic: task.normalizedTopic,
      pipelineVersion: task.pipelineVersion,
      sourceAdapterVersion: task.sourceAdapterVersion,
      modelAdapterVersion: task.modelAdapterVersion,
    });
  }

  private async searchDirections(
    task: GenerationTask,
    workerId: string,
    directions: readonly GenerationDirectionCandidate[],
  ): Promise<GenerationSourceCandidate[]> {
    const byId = new Map<string, GenerationSourceCandidate>();
    for (const direction of directions) {
      const response = await this.callSource(
        task,
        workerId,
        "searching",
        `search:${direction.directionId}`,
        { query: direction.searchQuery, directionId: direction.directionId },
        () =>
          this.providers.sourceSearch.search({
            query: direction.searchQuery,
            count: SEARCH_RESULTS_PER_DIRECTION,
            requestId: `${task.id}:search:${direction.directionId}`,
            timeoutMs: this.externalTimeout(task),
          }),
      );
      if (
        !asRecord(response) ||
        !isArray((response as { sources?: unknown }).sources)
      ) {
        throw new GenerationTaskFailure("source_unavailable", false);
      }
      for (const source of (
        response as { sources: readonly GenerationSourceCandidate[] }
      ).sources) {
        if (
          source &&
          typeof source.sourceId === "string" &&
          !byId.has(source.sourceId)
        ) {
          byId.set(source.sourceId, source);
        }
      }
    }
    return [...byId.values()];
  }

  private async supplementMap(
    task: GenerationTask,
    workerId: string,
    map: GenerationMapCandidate,
    sources: readonly GenerationSourceCandidate[],
  ): Promise<{
    map: GenerationMapCandidate;
    sources: readonly GenerationSourceCandidate[];
  }> {
    const byId = new Map(sources.map((source) => [source.sourceId, source]));
    const nodes = map.nodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
    }));
    for (const node of nodes) {
      if (node.sourceIds.length > 0) {
        continue;
      }
      const response = await this.callSource(
        task,
        workerId,
        "supplementing",
        `supplement:${node.nodeId}`,
        { query: `${task.topic} ${node.title}`, nodeId: node.nodeId },
        () =>
          this.providers.sourceSearch.search({
            query: `${task.topic} ${node.title}`,
            count: SUPPLEMENT_RESULTS_PER_NODE,
            requestId: `${task.id}:supplement:${node.nodeId}`,
            timeoutMs: this.externalTimeout(task),
          }),
      );
      const supplemental =
        asRecord(response) &&
        isArray((response as { sources?: unknown }).sources)
          ? (response as { sources: readonly GenerationSourceCandidate[] })
              .sources
          : [];
      for (const source of supplemental) {
        if (source && typeof source.sourceId === "string") {
          byId.set(source.sourceId, source);
        }
      }
      const first = supplemental.find(
        (source) => source && typeof source.sourceId === "string",
      );
      if (!first) {
        throw new GenerationTaskFailure("source_insufficient", false);
      }
      node.sourceIds = [first.sourceId];
    }
    return {
      map: { ...map, nodes },
      sources: [...byId.values()],
    };
  }

  private async validateLocally(
    candidate: GenerationCandidate,
  ): Promise<GenerationCandidate> {
    const startedAt = this.now().getTime();
    const validated = validateGenerationCandidate(candidate);
    if (this.now().getTime() - startedAt > LOCAL_OPERATION_TIMEOUT_MS) {
      throw new GenerationTaskFailure("generation_timeout", false);
    }
    return validated;
  }
}
