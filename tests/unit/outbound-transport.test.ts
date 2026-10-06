import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { sendWebhook } from "../../packages/security/src/outbound-url";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("pins freshly resolved public addresses and refuses a later private DNS answer", async () => {
  mocks.lookup
    .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
  mocks.request.mockImplementation((_url, options, done) => {
    options.lookup(
      "example.com",
      {},
      (_error: unknown, address: string, family: number) => {
        expect(address).toBe("8.8.8.8");
        expect(family).toBe(4);
      },
    );
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: () => void;
    };
    req.destroy = () => {};
    req.end = () => {
      done({ statusCode: 302, destroy: vi.fn() });
      req.emit("close");
    };
    return req;
  });
  expect(await sendWebhook("https://example.com/notify", "{}", {})).toBe(302);
  await expect(
    sendWebhook("https://example.com/notify", "{}", {}),
  ).rejects.toThrow("WEBHOOK_PRIVATE_ADDRESS");
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("bounds stalled DNS resolution before any connection is attempted", async () => {
  vi.useFakeTimers();
  mocks.lookup.mockReturnValue(new Promise(() => {}));
  const result = expect(
    sendWebhook("https://example.com", "{}", {}),
  ).rejects.toThrow("WEBHOOK_TIMEOUT");
  await vi.advanceTimersByTimeAsync(8001);
  await result;
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects mixed public and private DNS results without picking the public answer", async () => {
  mocks.lookup.mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ]);
  await expect(sendWebhook("https://example.com", "{}", {})).rejects.toThrow(
    "WEBHOOK_PRIVATE_ADDRESS",
  );
  expect(mocks.request).not.toHaveBeenCalled();
});
