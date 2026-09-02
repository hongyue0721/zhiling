import { authSchema } from "./auth-schema";
import { catalogSchema } from "./catalog-schema";

export const databaseSchema = {
  ...authSchema,
  ...catalogSchema,
};
