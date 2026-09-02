import type { GeneratedTransport } from "@/generated/provider/types";
import { platformValue } from "@/platform/value";

export function createAdapter(input: string): string {
  const value: GeneratedTransport = { value: `${platformValue}:${input}` };
  return value.value;
}
