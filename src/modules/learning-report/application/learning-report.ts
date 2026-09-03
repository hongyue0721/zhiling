import type { LearningMapDetail } from "@/modules/learning-catalog/public/contracts";
import type { LearningProgressSummary } from "@/modules/learning-progress/public/contracts";

import {
  projectPrivateLearningReport,
  type LearningReportInput,
  type PrivateLearningReport,
} from "../domain/learning-report";

export interface LearningReportMapReader {
  findByLearningRelationship(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningMapDetail | null>;
}

export interface LearningReportProgressReader {
  get(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningProgressSummary | null>;
}

function toReportInput(
  learningRelationshipId: string,
  map: LearningMapDetail,
  progress: LearningProgressSummary,
): LearningReportInput {
  return {
    requestedLearningRelationshipId: learningRelationshipId,
    map: {
      mapId: map.mapId,
      versionId: map.versionId,
      title: map.title,
      nodes: map.nodes.map((node) => ({
        nodeId: node.nodeId,
        title: node.title,
        learningObjective: node.learningObjective,
        sourceIds: [...node.sourceIds],
      })),
      prerequisites: map.prerequisites.map((edge) => ({ ...edge })),
      sources: map.sources.map((source) => ({
        sourceId: source.sourceId,
        title: source.title,
        url: source.url,
        authorName: source.authorName,
      })),
      viewpoints: map.viewpoints.map((viewpoint) => ({
        ...viewpoint,
        sourceIds: [...viewpoint.sourceIds],
      })),
    },
    progress: {
      learningRelationshipId: progress.learningRelationshipId,
      versionId: progress.versionId,
      questionSetId: progress.questionSetId,
      nodes: progress.nodes.map((node) => ({
        nodeId: node.nodeId,
        bestScore: node.bestScore,
        completed: node.completed,
      })),
      attempts: progress.attempts.map(({ nodeId }) => ({ nodeId })),
    },
  };
}

export class LearningReportService {
  constructor(
    private readonly mapReader: LearningReportMapReader,
    private readonly progressReader: LearningReportProgressReader,
  ) {}

  async find(
    userId: string,
    learningRelationshipId: string,
  ): Promise<PrivateLearningReport | null> {
    const [map, progress] = await Promise.all([
      this.mapReader.findByLearningRelationship(userId, learningRelationshipId),
      this.progressReader.get(userId, learningRelationshipId),
    ]);
    if (!map || !progress) {
      return null;
    }
    return projectPrivateLearningReport(
      toReportInput(learningRelationshipId, map, progress),
    );
  }
}
