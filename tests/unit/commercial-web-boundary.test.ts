import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
import { DomainError } from "../../packages/shared/src/index";
import { webOrigin } from "../../packages/config/src/web-origin";
import { billingWebhookRequest } from "../../apps/web/app/billing/webhook-request";
import { StripeBillingProvider } from "../../packages/settings/src/billing";

const state = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../../apps/web/app/auth/server-access", () => ({
  serverServices: () => ({ db: { transaction: state.transaction }, vault: {} }),
  manageableConnection: vi.fn(),
}));
import {
  POST as stripeWebhook,
  runtime,
} from "../../apps/web/app/billing/webhooks/stripe/route";
import { oauthRedirectUri } from "../../apps/web/app/auth/session";
import { proxy } from "../../apps/web/proxy";
import { sameOrigin } from "../../apps/web/app/auth/origin";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  state.transaction.mockClear();
});

it("forwards exact raw bytes and signature unchanged through the verified adapter boundary", async () => {
  const bytes = Uint8Array.from([
    0x7b, 0x20, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d, 0x0a, 0x00, 0xff,
  ]);
  const signature = "t=1790985600,v1=first,v1=second";
  const verify = vi.spyOn(
    StripeBillingProvider.prototype,
    "verifyWebhook",
  );
  const response = await stripeWebhook(
    new NextRequest("https://nexus.example/billing/webhooks/stripe", {
      method: "POST",
      headers: {
        "Stripe-Signature": signature,
        "Content-Length": String(bytes.length),
      },
      body: bytes,
    }),
  );
  expect(runtime).toBe("nodejs");
  expect(response.status).toBe(503);
  expect(verify).toHaveBeenCalledOnce();
  expect(verify.mock.calls[0]?.[0]).toEqual(Buffer.from(bytes));
  expect(verify.mock.calls[0]?.[1]).toEqual({
    "Stripe-Signature": signature,
    "Content-Length": String(bytes.length),
    "Nexus-Actual-Body-Length": String(bytes.length),
  });
  expect(state.transaction).not.toHaveBeenCalled();
});

it.each([undefined, "invalid"])(
  "missing/invalid signature %s never changes the signal inbox",
  async (signature) => {
    vi.spyOn(
      StripeBillingProvider.prototype,
      "verifyWebhook",
    ).mockRejectedValue(new DomainError("BILLING_SIGNATURE_INVALID", 403));
    const response = await stripeWebhook(
      new NextRequest("https://nexus.example/billing/webhooks/stripe", {
        method: "POST",
        headers: signature ? { "Stripe-Signature": signature } : {},
        body: '{ "untrusted": true }',
      }),
    );
    expect(response.status).toBe(403);
    expect(state.transaction).not.toHaveBeenCalled();
  },
);

it.each([undefined, "0", "1", "65536"])(
  "limits actual webhook bytes independently of declared length %s",
  async (declared) => {
    const verify = vi.spyOn(
      StripeBillingProvider.prototype,
      "verifyWebhook",
    );
    const response = await stripeWebhook(
      new NextRequest("https://nexus.example/billing/webhooks/stripe", {
        method: "POST",
        headers: declared === undefined ? {} : { "Content-Length": declared },
        body: "x".repeat(65537),
      }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("BILLING_EVENT_TOO_LARGE");
    expect(verify).not.toHaveBeenCalled();
    expect(state.transaction).not.toHaveBeenCalled();
  },
);

it("keeps actual and declared body lengths separate and rejects malformed or oversized declarations", async () => {
  const input = await billingWebhookRequest(
    new Request("https://nexus.example", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: "abc",
    }),
  );
  expect(input.actualBodyLength).toBe(3);
  expect(input.declaredContentLength).toBe("1");
  for (const declared of ["-1", "1.2", "broken"])
    await expect(
      billingWebhookRequest(
        new Request("https://nexus.example", {
          method: "POST",
          headers: { "Content-Length": declared },
          body: "abc",
        }),
      ),
    ).rejects.toThrow("BILLING_CONTENT_LENGTH_INVALID");
  await expect(
    billingWebhookRequest(
      new Request("https://nexus.example", {
        method: "POST",
        headers: { "Content-Length": "65537" },
        body: "abc",
      }),
    ),
  ).rejects.toThrow("BILLING_EVENT_TOO_LARGE");
});

it("production Host and forwarded protocol spoofing cannot change canonical or OAuth origins", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
  vi.stubEnv("NEXUS_WEB_URL", "https://nexus.example/");
  const request = new NextRequest("http://spoofed.example/dashboard", {
    headers: {
      host: "spoofed.example",
      "x-forwarded-proto": "http",
      origin: "https://spoofed.example",
      "sec-fetch-site": "same-origin",
    },
  });
  expect(webOrigin(request)).toBe("https://nexus.example");
  expect(webOrigin({ headers: request.headers })).toBe("https://nexus.example");
  expect(oauthRedirectUri()).toBe("https://nexus.example/auth/callback");
  expect(proxy(request).headers.get("location")).toBe(
    "https://nexus.example/auth/login",
  );
  expect(sameOrigin(request)).toBe(false);
});

it("production rejects missing canonical configuration while development permits request fallback", () => {
  const request = new Request("http://localhost:3210/");
  expect(() => webOrigin(request, { NODE_ENV: "production" })).toThrow(
    "NEXUS_WEB_URL is required in production",
  );
  expect(webOrigin(request, { NODE_ENV: "development" })).toBe(
    "http://localhost:3210",
  );
  expect(webOrigin(undefined, { NODE_ENV: "development" })).toBe(
    "http://localhost:3100",
  );
  for (const url of [
    "javascript:evil",
    "https://user:password@nexus.example",
    "https://nexus.example/path",
    "https://nexus.example?untrusted=true",
  ])
    expect(() =>
      webOrigin(request, { NODE_ENV: "production", NEXUS_WEB_URL: url }),
    ).toThrow();
});

it("anonymous Stripe webhook bypasses session redirects and remains adapter authorized", () => {
  vi.stubEnv("NEXUS_WEB_AUTH_MODE", "oauth");
  const response = proxy(
    new NextRequest("https://nexus.example/billing/webhooks/stripe", {
      method: "POST",
    }),
  );
  expect(response.headers.get("location")).toBeNull();
});
