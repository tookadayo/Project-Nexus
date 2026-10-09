import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfirmedLegalContacts } from "../../apps/operator/src/legal-contacts";

const fixture = {
  supportEmail: "support@example.invalid",
  rightsEmail: "privacy@example.invalid",
  confirmedOn: "2000-01-01",
};
let directory: string;
const localTemp = resolve(tmpdir());
beforeEach(async () => {
  vi.stubEnv("NEXUS_LEGAL_CONTACTS_PATH", undefined);
  directory = await mkdtemp(join(localTemp, "nexus-contact-fixture-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (!directory) return;
  if (
    dirname(resolve(directory)) !== localTemp ||
    !basename(directory).startsWith("nexus-contact-fixture-")
  )
    throw Error("TEST_DIRECTORY_BOUNDARY");
  await rm(directory, { recursive: true, force: true });
});
async function input(value: unknown) {
  const file = join(directory, "contacts.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return file;
}

describe("optional owner-confirmed contact record", () => {
  it("defaults to no contacts when an explicit source is absent", async () => {
    expect(await readConfirmedLegalContacts()).toBeNull();
    expect(await readConfirmedLegalContacts("")).toBeNull();
  });
  it("reads a strict local record only from the configured path and does not cache it", async () => {
    const file = await input(fixture);
    vi.stubEnv("NEXUS_LEGAL_CONTACTS_PATH", file);
    const first = await readConfirmedLegalContacts();
    expect(first).toEqual(fixture);
    expect(Object.isFrozen(first)).toBe(true);
    await writeFile(
      file,
      JSON.stringify({ ...fixture, confirmedOn: "2000-02-29" }),
    );
    expect((await readConfirmedLegalContacts())?.confirmedOn).toBe(
      "2000-02-29",
    );
  });
  it.each([
    { ...fixture, supportEmail: "invalid" },
    { ...fixture, rightsEmail: "invalid" },
    { ...fixture, rightsEmail: "SUPPORT@example.invalid" },
    { ...fixture, confirmedOn: "2001-02-29" },
    { ...fixture, confirmedOn: "2000-01-01T00:00:00Z" },
    { ...fixture, extra: "synthetic-private-note" },
    { supportEmail: fixture.supportEmail, rightsEmail: fixture.rightsEmail },
    null,
  ])(
    "rejects an invalid record without echoing its contents",
    async (value) => {
      const file = await input(value);
      await expect(readConfirmedLegalContacts(file)).rejects.toThrow(
        /^LEGAL_CONTACTS_UNAVAILABLE$/,
      );
    },
  );
  it("rejects malformed and oversized JSON with the same generic failure", async () => {
    const file = join(directory, "contacts.json");
    for (const value of [
      "{synthetic-private-content",
      JSON.stringify(fixture) + " ".repeat(4097),
    ]) {
      await writeFile(file, value);
      await expect(readConfirmedLegalContacts(file)).rejects.toThrow(
        /^LEGAL_CONTACTS_UNAVAILABLE$/,
      );
    }
  });
  it("does not disclose a missing path or read a non-file", async () => {
    await expect(
      readConfirmedLegalContacts(join(directory, "missing.json")),
    ).rejects.toThrow(/^LEGAL_CONTACTS_UNAVAILABLE$/);
    await expect(readConfirmedLegalContacts(directory)).rejects.toThrow(
      /^LEGAL_CONTACTS_UNAVAILABLE$/,
    );
  });
  it.each([
    "relative.json",
    "https://example.invalid/contacts.json",
    "\\\\example.invalid\\share\\contacts.json",
    "//example.invalid/share/contacts.json",
    " ",
  ])("rejects nonlocal or nonabsolute input %s", async (file) => {
    await expect(readConfirmedLegalContacts(file)).rejects.toThrow(
      /^LEGAL_CONTACTS_UNAVAILABLE$/,
    );
  });
});
