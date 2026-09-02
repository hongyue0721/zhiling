import {
  toFormalIdentity,
  type FormalIdentity,
} from "../domain/formal-identity";
import type { SessionIdentityReader } from "./ports";

export class FormalIdentityRequiredError extends Error {
  readonly code = "FORMAL_IDENTITY_REQUIRED";

  constructor() {
    super("A verified authenticated identity is required");
    this.name = "FormalIdentityRequiredError";
  }
}

export class IdentityService {
  constructor(private readonly sessionReader: SessionIdentityReader) {}

  async resolve(headers: Headers): Promise<FormalIdentity | null> {
    const sessionUser = await this.sessionReader.readSessionUser(headers);

    return sessionUser ? toFormalIdentity(sessionUser) : null;
  }

  async require(headers: Headers): Promise<FormalIdentity> {
    const identity = await this.resolve(headers);

    if (!identity) {
      throw new FormalIdentityRequiredError();
    }

    return identity;
  }
}
