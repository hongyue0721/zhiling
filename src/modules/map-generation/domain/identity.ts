export class InvalidGenerationTopicError extends Error {
  readonly code = "invalid_topic" as const;

  constructor() {
    super("Generation topic is empty or invalid");
    this.name = "InvalidGenerationTopicError";
  }
}

export function normalizeGenerationTopic(topic: string): string {
  if (typeof topic !== "string") {
    throw new InvalidGenerationTopicError();
  }
  const normalized = topic.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized.length === 0 || normalized.length > 240) {
    throw new InvalidGenerationTopicError();
  }
  return normalized.toLocaleLowerCase("en-US");
}

export type GenerationIdentity = Readonly<{
  normalizedTopic: string;
  pipelineVersion: string;
  sourceAdapterVersion: string;
  modelAdapterVersion: string;
}>;

export function createGenerationIdentity(
  topic: string,
  versions: Readonly<{
    pipelineVersion: string;
    sourceAdapterVersion: string;
    modelAdapterVersion: string;
  }>,
): GenerationIdentity {
  const normalizedTopic = normalizeGenerationTopic(topic);
  if (
    versions.pipelineVersion.trim().length === 0 ||
    versions.sourceAdapterVersion.trim().length === 0 ||
    versions.modelAdapterVersion.trim().length === 0
  ) {
    throw new Error("Generation provider versions must be non-empty");
  }
  return {
    normalizedTopic,
    pipelineVersion: versions.pipelineVersion,
    sourceAdapterVersion: versions.sourceAdapterVersion,
    modelAdapterVersion: versions.modelAdapterVersion,
  };
}
