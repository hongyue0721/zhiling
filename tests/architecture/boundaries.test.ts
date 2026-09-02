import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkArchitecture } from "../../scripts/check-architecture";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function issueCodes(
  fixture: string,
  moduleDependencies: Readonly<Record<string, readonly string[]>> = {},
): string[] {
  return checkArchitecture({
    root: join(fixtures, fixture),
    moduleDependencies,
  }).map(({ code }) => code);
}

describe("architecture boundaries", () => {
  it("accepts the documented dependency direction", () => {
    expect(issueCodes("valid", { alpha: ["beta"] })).toEqual([]);
  });

  it("rejects a cross-module internal import", () => {
    expect(issueCodes("cross-module-internal", { alpha: ["beta"] })).toContain(
      "cross-module-internal",
    );
  });

  it("rejects an undeclared cross-module dependency", () => {
    expect(issueCodes("valid")).toContain("undeclared-module-dependency");
  });

  it("rejects a reverse layer dependency", () => {
    expect(issueCodes("reverse-layer")).toContain("layer-dependency");
  });

  it("rejects a dependency cycle", () => {
    expect(issueCodes("circular")).toContain("circular-dependency");
  });

  it("rejects server code and private environment access from a client graph", () => {
    const codes = issueCodes("client-server");

    expect(codes).toContain("client-server-leak");
    expect(codes).toContain("client-private-environment");
  });

  it("rejects identity, database, and mail servers from a client graph", () => {
    expect(issueCodes("identity-client")).toContain("client-server-leak");
  });

  it("rejects an external dependency from the domain layer", () => {
    expect(issueCodes("domain-external")).toContain(
      "domain-external-dependency",
    );
  });

  it("rejects generated types in an application layer", () => {
    expect(issueCodes("generated-boundary")).toContain(
      "generated-import-forbidden",
    );
  });

  it("rejects generated source depending on handwritten source", () => {
    expect(issueCodes("generated-source-dependency")).toContain(
      "generated-source-dependency",
    );
  });
});
