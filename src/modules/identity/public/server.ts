import "server-only";

import {
  FormalIdentityRequiredError,
  type IdentityService,
} from "../application/identity-service";
import type { FormalIdentity as InternalFormalIdentity } from "../domain/formal-identity";
import {
  createIdentityRuntime as createInternalIdentityRuntime,
  type IdentityRuntimeDependencies,
} from "../infrastructure/runtime";
import type { FormalIdentity } from "./contracts";

export { FormalIdentityRequiredError };
export {
  readIdentityEnvironment,
  type IdentityEnvironment,
} from "../infrastructure/config";
export type { FormalIdentity } from "./contracts";

export type IdentityAccess = Readonly<{
  resolve(headers: Headers): Promise<FormalIdentity | null>;
  require(headers: Headers): Promise<FormalIdentity>;
}>;

export type AuthRouteHandlers = Readonly<{
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}>;

export type IdentityRuntime = Readonly<{
  identity: IdentityAccess;
  authHandlers: AuthRouteHandlers;
}>;

function toPublicIdentity(identity: InternalFormalIdentity): FormalIdentity {
  return {
    userId: identity.userId,
    email: identity.email,
    emailVerified: identity.emailVerified,
  };
}

function createPublicIdentityAccess(identity: IdentityService): IdentityAccess {
  return {
    async resolve(headers) {
      const resolved = await identity.resolve(headers);
      return resolved ? toPublicIdentity(resolved) : null;
    },
    async require(headers) {
      return toPublicIdentity(await identity.require(headers));
    },
  };
}

export function createIdentityRuntime(
  dependencies: IdentityRuntimeDependencies,
): IdentityRuntime {
  const runtime = createInternalIdentityRuntime(dependencies);

  return {
    identity: createPublicIdentityAccess(runtime.identity),
    authHandlers: runtime.authHandlers,
  };
}
