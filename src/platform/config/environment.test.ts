import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readPublicEnvironment } from "./client";
import { EnvironmentConfigurationError, parseEnvironment } from "./environment";

describe("environment configuration", () => {
  it("fails explicitly without exposing a rejected value", () => {
    const rejectedValue = "must-not-appear";
    let caught: unknown;

    try {
      parseEnvironment(
        "fixture",
        z.object({ REQUIRED_VALUE: z.literal("accepted") }),
        { REQUIRED_VALUE: rejectedValue },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvironmentConfigurationError);
    expect(String(caught)).toContain("REQUIRED_VALUE");
    expect(String(caught)).not.toContain(rejectedValue);
  });

  it("fails when required configuration is missing", () => {
    expect(() =>
      parseEnvironment(
        "fixture",
        z.object({ REQUIRED_VALUE: z.string().min(1) }),
        {},
      ),
    ).toThrowError(EnvironmentConfigurationError);
  });

  it("accepts only explicitly public client keys", () => {
    const publicEnvironment = readPublicEnvironment(
      { NEXT_PUBLIC_FIXTURE: z.string().min(1) },
      { NEXT_PUBLIC_FIXTURE: "visible" },
    );

    expect(publicEnvironment.NEXT_PUBLIC_FIXTURE).toBe("visible");
  });

  it("rejects a private key in the client schema", () => {
    const privateShape = { SERVER_SECRET: z.string() };

    expect(() =>
      Reflect.apply(readPublicEnvironment, undefined, [
        privateShape,
        { SERVER_SECRET: "not-exposed" },
      ]),
    ).toThrowError(EnvironmentConfigurationError);
  });
});
