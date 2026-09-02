import type { LearningMapDetail } from "@/modules/learning-catalog/public/contracts";

import type {
  LearningProgressRepository,
  LearningProgressSummary,
} from "./read-model";

export interface LearningProgressMapReader {
  findByLearningRelationship(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningMapDetail | null>;
}

export class LearningProgressService {
  constructor(
    private readonly repository: LearningProgressRepository,
    private readonly mapReader: LearningProgressMapReader,
  ) {}

  async find(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningProgressSummary | null> {
    const map = await this.mapReader.findByLearningRelationship(
      userId,
      learningRelationshipId,
    );
    if (!map) {
      return null;
    }
    return this.repository.find(
      userId,
      learningRelationshipId,
      map.versionId,
      map.nodes.map(({ nodeId }) => nodeId),
    );
  }
}
