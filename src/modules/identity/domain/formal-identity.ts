export type FormalIdentity = Readonly<{
  userId: string;
  email: string;
  emailVerified: boolean;
}>;

export function toFormalIdentity(candidate: {
  id: string;
  email: string;
  emailVerified: boolean;
}): FormalIdentity {
  return {
    userId: candidate.id,
    email: candidate.email.trim().toLowerCase(),
    emailVerified: candidate.emailVerified,
  };
}
