export type FormalIdentity = Readonly<{
  userId: string;
  email: string;
  emailVerified: true;
}>;

export function toFormalIdentity(candidate: {
  id: string;
  email: string;
  emailVerified: boolean;
}): FormalIdentity | null {
  if (!candidate.emailVerified) {
    return null;
  }

  return {
    userId: candidate.id,
    email: candidate.email.trim().toLowerCase(),
    emailVerified: true,
  };
}
