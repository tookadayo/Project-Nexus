import { EventEmitter } from "node:events";
import type { Page, Request, Response } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import { classifySetupStatus, observeSetupStatus, setupStatusBodyGate, STATUS_DIAGNOSTIC_BODY_LIMIT } from "../e2e/alpha17-setup-status-diagnostic";

const origin = "https://app.nexus.test:3150";
const sensitive = "synthetic-sensitive-value-not-for-output";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture() {
  const events = new EventEmitter();
  const observer = observeSetupStatus(events as unknown as Page, origin);
  const request = (url = origin + "/data/setup/status?guild=" + sensitive, method = "GET", size = 1024) => ({
    url: () => url, method: () => method, sizes: vi.fn(async () => ({ responseBodySize: size })),
  } as unknown as Request);
  const response = (req: Request, options: {
    body?: string; size?: number; encoding?: string; length?: string; status?: number;
    finished?: () => Promise<Error | null>; serviceWorker?: boolean; bodyFailure?: boolean;
  } = {}) => {
    const body = vi.fn(async () => {
      if (options.bodyFailure) throw new Error(sensitive);
      return Buffer.from(options.body ?? JSON.stringify({ state: "SETUP_REQUIRED", settings: { private: sensitive } }));
    });
    return { request: () => req, status: () => options.status ?? 200,
      fromServiceWorker: () => options.serviceWorker ?? false,
      finished: options.finished ?? (async () => null),
      headerValue: async (name: string) => name === "content-encoding" ? options.encoding ?? null : options.length ?? null,
      body,
    } as unknown as Response & { body: typeof body };
  };
  return { events, observer, request, response };
}

describe("bounded passive setup status diagnostics", () => {
  it("retains only closed-vocabulary error/state and settings presence", () => {
    expect(classifySetupStatus({ error: "SESSION_REQUIRED", state: "LINK_REQUIRED", settings: null, token: sensitive }))
      .toEqual({ phase: "READ", error: "SESSION_REQUIRED", state: "LINK_REQUIRED", hasSettings: false });
    const result = classifySetupStatus({ error: sensitive, state: sensitive, settings: { token: sensitive }, cookie: sensitive });
    expect(result).toEqual({ phase: "READ", error: "OTHER", state: "OTHER", hasSettings: true });
    expect(JSON.stringify(result)).not.toContain(sensitive);
    for (const body of [null, [], sensitive, 7]) expect(classifySetupStatus(body).phase).toBe("NON_OBJECT");
  });

  it.each([0, -1, NaN, Infinity, 1.5])("rejects unavailable or invalid measured wire size %s", size => {
    expect(setupStatusBodyGate(size, null, null)).toBe("SIZE_UNAVAILABLE");
  });

  it("permits absent Content-Length only with a positive bounded unencoded wire size", () => {
    expect(setupStatusBodyGate(1, null, null)).toBeNull();
    expect(setupStatusBodyGate(STATUS_DIAGNOSTIC_BODY_LIMIT, "identity", null)).toBeNull();
    expect(setupStatusBodyGate(STATUS_DIAGNOSTIC_BODY_LIMIT + 1, null, null)).toBe("TOO_LARGE");
    expect(setupStatusBodyGate(5, "gzip", "5")).toBe("ENCODED");
    expect(setupStatusBodyGate(5, "br", null)).toBe("ENCODED");
    expect(setupStatusBodyGate(5, null, "6")).toBe("LENGTH_MISMATCH");
    expect(setupStatusBodyGate(5, null, sensitive)).toBe("INVALID_LENGTH");
    expect(setupStatusBodyGate(5, null, "5")).toBeNull();
  });

  it("classifies an existing known-origin GET without retaining its query, headers or body", async () => {
    const f = fixture(), req = f.request(), response = f.response(req);
    f.events.emit("request", req);
    f.events.emit("response", response);
    await tick();
    const snapshot = f.observer.stop();
    expect(snapshot.requestCount).toBe(1);
    expect(snapshot.responseCount).toBe(1);
    expect(snapshot.entries).toEqual([{ status: 200, phase: "READ", error: null, state: "SETUP_REQUIRED", hasSettings: true }]);
    expect(response.body).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(snapshot)).not.toContain(sensitive);
    expect(f.events.eventNames()).toEqual([]);
  });

  it("ignores foreign origins, other paths, POST and malformed URLs", async () => {
    const f = fixture();
    for (const req of [f.request("https://elsewhere.invalid/data/setup/status"), f.request(origin + "/other"),
      f.request(undefined, "POST"), f.request("invalid-url")]) {
      f.events.emit("request", req);
      const response = f.response(req);
      f.events.emit("response", response);
      await tick();
      expect(response.body).not.toHaveBeenCalled();
    }
    const snapshot = f.observer.stop();
    expect(snapshot.requestCount).toBe(0);
    expect(snapshot.entries).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(sensitive);
  });

  it("caps synchronous reservations and both counters at four", async () => {
    const f = fixture();
    for (let index = 0; index < 12; index++) {
      const req = f.request(), response = f.response(req);
      f.events.emit("request", req);
      f.events.emit("response", response);
      if (index >= 4) expect(response.body).not.toHaveBeenCalled();
    }
    await tick();
    const snapshot = f.observer.stop();
    expect(snapshot.entries).toHaveLength(4);
    expect(snapshot.requestCount).toBe(4);
    expect(snapshot.responseCount).toBe(4);
    expect(snapshot.limitReached).toBe(true);
  });

  it.each([
    { size: 0, phase: "SIZE_UNAVAILABLE" }, { size: STATUS_DIAGNOSTIC_BODY_LIMIT + 1, phase: "TOO_LARGE" },
    { encoding: "gzip", phase: "ENCODED" }, { length: "999", phase: "LENGTH_MISMATCH" },
    { serviceWorker: true, phase: "SERVICE_WORKER" },
  ])("never reads a body rejected by its bound or source: $phase", async options => {
    const f = fixture(), req = f.request(undefined, undefined, options.size), response = f.response(req, options);
    f.events.emit("request", req);
    f.events.emit("response", response);
    await tick();
    expect(f.observer.stop().entries[0]?.phase).toBe(options.phase);
    expect(response.body).not.toHaveBeenCalled();
  });

  it("records HTTP failure classification without copying error text", async () => {
    const f = fixture(), req = f.request(), response = f.response(req, { status: 401,
      body: JSON.stringify({ error: "SESSION_REQUIRED", details: sensitive, settings: null }) });
    f.events.emit("request", req);
    f.events.emit("response", response);
    await tick();
    const snapshot = f.observer.stop();
    expect(snapshot.entries[0]).toEqual({ status: 401, phase: "READ", error: "SESSION_REQUIRED", state: null, hasSettings: false });
    expect(JSON.stringify(snapshot)).not.toContain(sensitive);
  });

  it("stops immediately with pending state and prevents late body reads or snapshot mutation", async () => {
    const f = fixture(), req = f.request();
    let finish!: (error: Error | null) => void;
    const response = f.response(req, { finished: () => new Promise(resolve => { finish = resolve; }) });
    f.events.emit("request", req);
    f.events.emit("response", response);
    const snapshot = f.observer.stop();
    expect(snapshot.entries[0]?.phase).toBe("WAITING_FINISH");
    finish(null);
    await tick();
    expect(response.body).not.toHaveBeenCalled();
    expect(snapshot.entries[0]?.phase).toBe("WAITING_FINISH");
  });

  it("distinguishes an unanswered request from one that failed", () => {
    const f = fixture(), pending = f.request(), failed = f.request();
    f.events.emit("request", pending);
    f.events.emit("request", failed);
    f.events.emit("requestfailed", failed);
    expect(f.observer.stop().entries.map(entry => entry.phase)).toEqual(["WAITING_RESPONSE", "REQUEST_FAILED"]);
  });

  it.each(["finish-error", "finish-reject", "body-reject", "invalid-json", "oversized-body"])("contains observation errors: %s", async kind => {
    const f = fixture(), req = f.request(), response = f.response(req, {
      finished: kind === "finish-error" ? async () => new Error(sensitive) :
        kind === "finish-reject" ? async () => { throw new Error(sensitive); } : undefined,
      bodyFailure: kind === "body-reject",
      body: kind === "invalid-json" ? sensitive : kind === "oversized-body" ? sensitive.repeat(1000) : undefined,
    });
    f.events.emit("request", req);
    f.events.emit("response", response);
    await tick();
    const snapshot = f.observer.stop();
    const expected = kind === "finish-error" ? "FINISH_FAILED" : kind === "invalid-json" ? "INVALID_JSON" :
      kind === "oversized-body" ? "LENGTH_MISMATCH" : "OBSERVATION_FAILED";
    expect(snapshot.entries[0]?.phase).toBe(expected);
    expect(JSON.stringify(snapshot)).not.toContain(sensitive);
    const assertionFailure = new Error("ORIGINAL_ASSERTION_FAILURE");
    expect(() => { try { throw assertionFailure; } finally { f.observer.stop(); } }).toThrow(assertionFailure);
  });
});
