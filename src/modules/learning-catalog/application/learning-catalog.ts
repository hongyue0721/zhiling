import type { LearningMapPublication } from "../domain/learning-map";
import { validateLearningMapPublication } from "../domain/learning-map";
import type {
  FeaturedLearningMapDetail,
  FeaturedLearningMapReader,
  FeaturedLearningMapSummary,
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
  constructor(private readonly reader: FeaturedLearningMapReader) {}

  async listFeatured(): Promise<readonly FeaturedLearningMapSummary[]> {
    return this.reader.listFeatured();
  }

  async findFeatured(mapId: string): Promise<FeaturedLearningMapDetail | null> {
    return this.reader.findFeatured(mapId);
  }
}
