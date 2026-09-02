import type {
  VerificationEmail,
  VerificationEmailSender,
} from "../application/ports";

export class RecordingVerificationEmailSender implements VerificationEmailSender {
  readonly messages: VerificationEmail[] = [];

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    this.messages.push({ ...message });
  }
}
