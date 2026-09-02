import "server-only";

import type {
  FeaturedLearningMapDetail as InternalDetail,
  FeaturedLearningMapSummary as InternalSummary,
} from "../application/read-model";
import {
  createLearningCatalogRuntime as createInternalLearningCatalogRuntime,
  type LearningCatalogRuntimeDependencies,
} from "../infrastructure/runtime";
import type {
  FeaturedLearningMapDetail,
  FeaturedLearningMapSummary,
} from "./contracts";

export type LearningCatalogAccess = Readonly<{
  listFeatured(): Promise<readonly FeaturedLearningMapSummary[]>;
  findFeatured(mapId: string): Promise<FeaturedLearningMapDetail | null>;
}>;

export type LearningCatalogRuntime = Readonly<{
  catalog: LearningCatalogAccess;
}>;

function toPublicSummary(summary: InternalSummary): FeaturedLearningMapSummary {
  return {
    mapId: summary.mapId,
    versionId: summary.versionId,
    title: summary.title,
    summary: summary.summary,
    nodeCount: summary.nodeCount,
  };
}

function toPublicDetail(detail: InternalDetail): FeaturedLearningMapDetail {
  return {
    mapId: detail.mapId,
    versionId: detail.versionId,
    title: detail.title,
    summary: detail.summary,
    nodes: detail.nodes.map((node) => ({
      nodeId: node.nodeId,
      title: node.title,
      learningObjective: node.learningObjective,
      sourceIds: [...node.sourceIds],
    })),
    prerequisites: detail.prerequisites.map((edge) => ({
      nodeId: edge.nodeId,
      prerequisiteNodeId: edge.prerequisiteNodeId,
    })),
    sources: detail.sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      excerpt: source.excerpt,
      url: source.url,
      authorName: source.authorName,
    })),
    viewpoints: detail.viewpoints.map((viewpoint) => ({
      viewpointId: viewpoint.viewpointId,
      nodeId: viewpoint.nodeId,
      kind: viewpoint.kind,
      statement: viewpoint.statement,
      conditions: viewpoint.conditions,
      sourceIds: [...viewpoint.sourceIds],
    })),
  };
}

export function createLearningCatalogRuntime(
  dependencies: LearningCatalogRuntimeDependencies,
): LearningCatalogRuntime {
  const runtime = createInternalLearningCatalogRuntime(dependencies);
  return {
    catalog: {
      async listFeatured() {
        const items = await runtime.catalog.listFeatured();
        return items.map(toPublicSummary);
      },
      async findFeatured(mapId) {
        const detail = await runtime.catalog.findFeatured(mapId);
        return detail ? toPublicDetail(detail) : null;
      },
    },
  };
}

export type {
  FeaturedLearningMapDetail,
  FeaturedLearningMapSummary,
  ViewpointKind,
} from "./contracts";
