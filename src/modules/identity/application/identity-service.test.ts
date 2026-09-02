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
  it("returns only the stable normalized verified identity", async () => {
    const service = new IdentityService(
      new FixedSessionReader({
        id: "stable-user-id",
        email: "  User@Example.COM ",
        emailVerified: true,
      }),
    );

    await expect(service.resolve(new Headers())).resolves.toEqual({
      userId: "stable-user-id",
      email: "user@example.com",
      emailVerified: true,
    });
  });

  it.each([
    null,
    { id: "unverified", email: "user@example.com", emailVerified: false },
  ])("rejects absent and unverified session users", async (user) => {
    const service = new IdentityService(new FixedSessionReader(user));

    await expect(service.resolve(new Headers())).resolves.toBeNull();
    await expect(service.require(new Headers())).rejects.toBeInstanceOf(
      FormalIdentityRequiredError,
    );
  });
});
