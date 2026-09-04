import { describe, expect, it } from "vitest";

import {
  FormalIdentityRequiredError,
  IdentityService,
} from "./identity-service";
import type { SessionIdentityReader, SessionUser } from "./ports";

class FixedSessionReader implements SessionIdentityReader {
  constructor(private readonly user: SessionUser | null) {}

  async readSessionUser() {
    return this.user;
  }
}

describe("formal identity service", () => {
  it("returns only the stable normalized identity", async () => {
    const service = new IdentityService(
      new FixedSessionReader({
        id: "stable-user-id",
        email: "  User@Example.COM ",
        emailVerified: true,
      }),
      { emailVerificationEnabled: true },
    );

    await expect(service.resolve(new Headers())).resolves.toEqual({
      userId: "stable-user-id",
      email: "user@example.com",
      emailVerified: true,
    });
  });

  it("rejects absent and unverified users when verification is enabled", async () => {
    const service = new IdentityService(
      new FixedSessionReader({
        id: "unverified",
        email: "user@example.com",
        emailVerified: false,
      }),
      { emailVerificationEnabled: true },
    );

    await expect(service.resolve(new Headers())).resolves.toBeNull();
    await expect(service.require(new Headers())).rejects.toBeInstanceOf(
      FormalIdentityRequiredError,
    );
  });

  it("accepts an unverified user when verification is disabled", async () => {
    const service = new IdentityService(
      new FixedSessionReader({
        id: "unverified",
        email: " User@Example.COM ",
        emailVerified: false,
      }),
      { emailVerificationEnabled: false },
    );

    await expect(service.resolve(new Headers())).resolves.toEqual({
      userId: "unverified",
      email: "user@example.com",
      emailVerified: false,
    });
  });

  it("rejects an absent session regardless of verification policy", async () => {
    const service = new IdentityService(new FixedSessionReader(null), {
      emailVerificationEnabled: false,
    });

    await expect(service.resolve(new Headers())).resolves.toBeNull();
    await expect(service.require(new Headers())).rejects.toBeInstanceOf(
      FormalIdentityRequiredError,
    );
  });
});
