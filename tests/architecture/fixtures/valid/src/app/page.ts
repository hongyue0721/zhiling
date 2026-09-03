import { composeFixture } from "@/bootstrap/compose";
import { componentFixture } from "@/components/fixture";

export const fixture = `${componentFixture}:${composeFixture()}`;
