import { authSchema } from "./auth-schema";
import { assessmentSchema } from "./assessment-schema";
import { catalogSchema } from "./catalog-schema";
import { progressSchema } from "./progress-schema";

export const databaseSchema = {
  ...authSchema,
  ...catalogSchema,
  ...assessmentSchema,
  ...progressSchema,
};
