import "server-only";

import { runFixture } from "../application/run";
import { createAdapter } from "../infrastructure/adapter";

export function createFixture(platformValue: string) {
  return runFixture(createAdapter(platformValue));
}
