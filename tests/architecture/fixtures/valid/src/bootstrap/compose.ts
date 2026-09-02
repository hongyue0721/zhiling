import { createFixture } from "@/modules/alpha/public/server";
import { platformValue } from "@/platform/value";

export function composeFixture() {
  return createFixture(platformValue);
}
