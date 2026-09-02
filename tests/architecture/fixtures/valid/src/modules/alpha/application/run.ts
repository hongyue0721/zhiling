import type { BetaContract } from "@/modules/beta/public/contracts";
import { createValue } from "../domain/value";

export function runFixture(input: string): BetaContract {
  return { value: createValue(input) };
}
