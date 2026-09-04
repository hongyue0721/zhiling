import {
  toFormalIdentity,
  type FormalIdentity,
} from "../domain/formal-identity";
import type { SessionIdentityReader } from "./ports";

export type IdentityServiceOptions = Readonly<{
  emailVerificationEnabled: boolean;
}>;

export class FormalIdentityRequiredError extends Error {
  readonly code = "FORMAL_IDENTITY_REQUIRED";

  constructor() {
    super("An authenticated identity is required");
    this.name = "FormalIdentityRequiredError";
  }
}

export class IdentityService {
  constructor(
    private readonly sessionReader: SessionIdentityReader,
    private readonly options: IdentityServiceOptions,
  ) {}

  async resolve(headers: Headers): Promise<FormalIdentity | null> {
    const sessionUser = await this.sessionReader.readSessionUser(headers);
    if (!sessionUser) {
      return null;
    }

    if (this.options.emailVerificationEnabled && !sessionUser.emailVerified) {
      return null;
    }

    return toFormalIdentity(sessionUser);
  }

  async require(headers: Headers): Promise<FormalIdentity> {
    const identity = await this.resolve(headers);

    if (!identity) {
      throw new FormalIdentityRequiredError();
    }

    return identity;
  }
}
