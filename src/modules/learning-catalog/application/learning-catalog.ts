import type { LearningMapPublication } from "../domain/learning-map";
import { validateLearningMapPublication } from "../domain/learning-map";
import type {
  FeaturedLearningMapSummary,
  LearningCatalogReader,
  LearningMapDetail,
  LearningRelationship,
  LearningRelationshipWriter,
} from "./read-model";

export interface LearningMapPublisher {
  publishFeatured(publication: LearningMapPublication): Promise<void>;
}

export class PublishFeaturedLearningMap {
  constructor(private readonly publisher: LearningMapPublisher) {}

  async execute(publication: LearningMapPublication): Promise<void> {
    const validated = validateLearningMapPublication(publication);
    await this.publisher.publishFeatured(validated);
  }
}

export class LearningCatalogService {
  constructor(
    private readonly reader: LearningCatalogReader,
    private readonly relationshipWriter: LearningRelationshipWriter,
  ) {}

  async listFeatured(): Promise<readonly FeaturedLearningMapSummary[]> {
    return this.reader.listFeatured();
  }

  async findFeatured(mapId: string): Promise<LearningMapDetail | null> {
    return this.reader.findFeatured(mapId);
  }

  async findByLearningRelationship(
    userId: string,
    learningRelationshipId: string,
  ): Promise<LearningMapDetail | null> {
    return this.reader.findByLearningRelationship(
      userId,
      learningRelationshipId,
    );
  }

  async establishLearningRelationship(
    userId: string,
    versionId: string,
  ): Promise<LearningRelationship | null> {
    return this.relationshipWriter.establish(userId, versionId);
  }
}
