import type { SessionIdentityReader, SessionUser } from "../application/ports";

type ReadBetterAuthSession = (
  headers: Headers,
) => Promise<{ user: SessionUser } | null>;

export class BetterAuthSessionReader implements SessionIdentityReader {
  constructor(private readonly readSession: ReadBetterAuthSession) {}

  async readSessionUser(headers: Headers): Promise<SessionUser | null> {
    const session = await this.readSession(headers);

    if (!session) {
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
    };
  }
}
