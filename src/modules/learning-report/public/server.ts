import "server-only";

import {
  LearningReportService,
  type LearningReportMapReader,
  type LearningReportProgressReader,
} from "../application/learning-report";
import type { PrivateLearningReport as InternalLearningReport } from "../domain/learning-report";
import type { PrivateLearningReport } from "./contracts";

export type LearningReportRuntimeDependencies = Readonly<{
  mapReader: LearningReportMapReader;
  progressReader: LearningReportProgressReader;
}>;

export type LearningReportAccess = Readonly<{
  get(
    userId: string,
    learningRelationshipId: string,
  ): Promise<PrivateLearningReport | null>;
}>;

export type LearningReportRuntime = Readonly<{
  report: LearningReportAccess;
}>;

function toPublicReport(report: InternalLearningReport): PrivateLearningReport {
  return {
    learningRelationshipId: report.learningRelationshipId,
    map: { ...report.map },
    questionSetId: report.questionSetId,
    completion: { ...report.completion },
    weakNodes: report.weakNodes.map((node) => ({
      ...node,
      sourceIds: [...node.sourceIds],
    })),
    encounteredViewpoints: report.encounteredViewpoints.map((viewpoint) => ({
      ...viewpoint,
      sourceIds: [...viewpoint.sourceIds],
    })),
    nextSteps: report.nextSteps.map((step) => ({
      ...step,
      sourceIds: [...step.sourceIds],
    })),
    sources: report.sources.map((source) => ({ ...source })),
  };
}

export function createLearningReportRuntime(
  dependencies: LearningReportRuntimeDependencies,
): LearningReportRuntime {
  const service = new LearningReportService(
    dependencies.mapReader,
    dependencies.progressReader,
  );
  return {
    report: {
      async get(userId, learningRelationshipId) {
        const report = await service.find(userId, learningRelationshipId);
        return report ? toPublicReport(report) : null;
      },
    },
  };
}

export type { PrivateLearningReport } from "./contracts";
