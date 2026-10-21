import { once } from "node:events";
import { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { trackOwnedSocket } from "../e2e/alpha17-owned-sockets";

const created: Socket[] = [];
const socket = () => { const value = new Socket(); created.push(value); return value; };
const destroy = async (value: Socket) => {
  if (value.closed) return;
  const closed = once(value, "close");
  value.destroy();
  await closed;
};
afterEach(async () => {
  await Promise.all(created.map(destroy));
  expect(created.every(value => value.destroyed)).toBe(true);
  created.length = 0;
});

describe("alpha17 owned socket tracking", () => {
  it("registers one close listener when the same socket is reused", () => {
    const owned = new Set<Socket>(), value = socket(), max = value.getMaxListeners();
    for (let reuse = 0; reuse < 100; reuse++) expect(trackOwnedSocket(owned, value)).toBe(value);
    expect(owned.size).toBe(1);
    expect(owned.has(value)).toBe(true);
    expect(value.listenerCount("close")).toBe(1);
    expect(value.getMaxListeners()).toBe(max);
  });

  it("removes the owned registration when a real socket closes", async () => {
    const owned = new Set<Socket>(), value = socket();
    trackOwnedSocket(owned, value);
    await destroy(value);
    expect(owned.size).toBe(0);
    expect(value.listenerCount("close")).toBe(0);
  });

  it("keeps sockets independent and destroys all remaining owned sockets", async () => {
    const owned = new Set<Socket>(), first = socket(), second = socket(), third = socket();
    for (const value of [first, second, third, first, second]) trackOwnedSocket(owned, value);
    await destroy(first);
    expect(owned.size).toBe(2);
    expect(owned.has(first)).toBe(false);
    expect(owned.has(second) && owned.has(third)).toBe(true);
    const closed = [...owned].map(value => once(value, "close"));
    for (const value of owned) value.destroy();
    await Promise.all(closed);
    expect(owned.size).toBe(0);
    expect([first, second, third].every(value => value.destroyed && value.listenerCount("close") === 0)).toBe(true);
  });

  it("preserves another owner's close listener", async () => {
    const owned = new Set<Socket>(), value = socket();
    let externalClosed = 0;
    const external = () => { externalClosed++; };
    value.on("close", external);
    for (let reuse = 0; reuse < 100; reuse++) trackOwnedSocket(owned, value);
    expect(value.listenerCount("close")).toBe(2);
    await destroy(value);
    expect(externalClosed).toBe(1);
    expect(owned.size).toBe(0);
    expect(value.listeners("close")).toEqual([external]);
    value.off("close", external);
  });
});
