import { expect, it } from "vitest";
import {
  publicAddress,
  outboundUrl,
} from "../../packages/security/src/outbound-url";
it.each([
  "127.0.0.1",
  "10.0.0.1",
  "172.16.1.1",
  "192.168.1.1",
  "169.254.169.254",
  "100.64.0.1",
  "0.0.0.0",
  "224.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
  "fc00::1",
  "fe80::1",
  "2001:db8::1",
])("rejects nonpublic address %s", (address) =>
  expect(publicAddress(address)).toBe(false),
);
it("accepts global transport addresses and rejects redirect/credential/local URL inputs", () => {
  expect(publicAddress("8.8.8.8")).toBe(true);
  expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  for (const value of [
    "http://example.com",
    "https://localhost",
    "https://example.local",
    "https://127.0.0.1",
    "https://user:password@example.com",
    "https://example.com:8080",
    "https://example.com/#secret",
  ])
    expect(() => outboundUrl(value)).toThrow();
  expect(outboundUrl("https://example.com/operations").pathname).toBe(
    "/operations",
  );
});
