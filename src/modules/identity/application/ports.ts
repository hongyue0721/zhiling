export type SessionUser = Readonly<{
  id: string;
  email: string;
  emailVerified: boolean;
}>;

export interface SessionIdentityReader {
  readSessionUser(headers: Headers): Promise<SessionUser | null>;
}

export type VerificationEmail = Readonly<{
  recipient: string;
  verificationUrl: string;
}>;

export interface VerificationEmailSender {
  sendVerificationEmail(message: VerificationEmail): Promise<void>;
}
