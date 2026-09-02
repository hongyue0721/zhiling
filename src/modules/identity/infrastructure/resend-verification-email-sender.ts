import "server-only";

import type { VerificationEmailSender } from "../application/ports";

export class VerificationEmailDeliveryError extends Error {
  readonly code = "VERIFICATION_EMAIL_DELIVERY_FAILED";

  constructor() {
    super("Verification email delivery failed");
    this.name = "VerificationEmailDeliveryError";
  }
}

export class ResendVerificationEmailSender implements VerificationEmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async sendVerificationEmail({
    recipient,
    verificationUrl,
  }: Parameters<VerificationEmailSender["sendVerificationEmail"]>[0]) {
    try {
      const response = await this.request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [recipient],
          subject: "验证你的知径邮箱",
          text: `请打开以下一次性链接验证邮箱（1 小时内有效）：\n\n${verificationUrl}`,
        }),
      });

      if (!response.ok) {
        throw new VerificationEmailDeliveryError();
      }
    } catch {
      throw new VerificationEmailDeliveryError();
    }
  }
}
