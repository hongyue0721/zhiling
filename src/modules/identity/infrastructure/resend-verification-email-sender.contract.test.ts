import { describe, expect, it, vi } from "vitest";

import {
  ResendVerificationEmailSender,
  VerificationEmailDeliveryError,
} from "./resend-verification-email-sender";

describe("Resend verification email adapter", () => {
  it("calls the Resend HTTP API with only verification-mail content", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "email-id" }), { status: 200 }),
      );
    const sender = new ResendVerificationEmailSender(
      "re_private_key",
      "知径 <auth@example.com>",
      request,
    );
    const verificationUrl =
      "https://app.example.com/api/auth/verify-email?token=one-time-token";

    await sender.sendVerificationEmail({
      recipient: "user@example.com",
      verificationUrl,
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer re_private_key",
    );
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: "知径 <auth@example.com>",
      to: ["user@example.com"],
    });
    expect(String(body.text)).toContain(verificationUrl);
    expect(String(body.text)).not.toContain("password");
    expect(String(body.text)).not.toContain("session");
  });

  it("maps provider responses and transport failures to one safe error", async () => {
    const providerBody = "upstream-secret-diagnostic";
    const apiKey = "re_key_that_must_not_escape";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(providerBody, { status: 503 }))
      .mockRejectedValueOnce(new Error(providerBody));
    const sender = new ResendVerificationEmailSender(
      apiKey,
      "auth@example.com",
      request,
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let caught: unknown;
      try {
        await sender.sendVerificationEmail({
          recipient: "user@example.com",
          verificationUrl: "https://app.example.com/verify?token=secret-token",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(VerificationEmailDeliveryError);
      expect(String(caught)).not.toContain(providerBody);
      expect(String(caught)).not.toContain(apiKey);
      expect(String(caught)).not.toContain("secret-token");
    }
  });
});
