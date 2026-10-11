import { open } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { z } from "zod";

const contactSchema = z
  .object({
    supportEmail: z.string().email().max(254),
    rightsEmail: z.string().email().max(254),
    confirmedOn: z.iso.date(),
  })
  .strict()
  .refine(
    (value) =>
      value.supportEmail.toLowerCase() !== value.rightsEmail.toLowerCase(),
  );

export type ConfirmedLegalContacts = Readonly<z.infer<typeof contactSchema>>;
export type LegalContactsLoader = () => Promise<ConfirmedLegalContacts | null>;

// Optional owner-maintained record, separate from saved operator review settings.
// This records the owner's confirmation; it does not verify delivery or grant publication.
export async function readConfirmedLegalContacts(
  sourcePath = process.env.NEXUS_LEGAL_CONTACTS_PATH,
): Promise<ConfirmedLegalContacts | null> {
  if (!sourcePath) return null;
  try {
    if (
      !isAbsolute(sourcePath) ||
      /^[\\/]{2}/.test(sourcePath) ||
      extname(sourcePath).toLowerCase() !== ".json"
    )
      throw new Error();
    const handle = await open(sourcePath, "r");
    try {
      if (!(await handle.stat()).isFile()) throw new Error();
      // Read a bounded record. No import-time reads, discovery, cache or logging.
      const buffer = Buffer.alloc(4097);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) throw new Error();
      return Object.freeze(
        contactSchema.parse(JSON.parse(buffer.toString("utf8", 0, bytesRead))),
      );
    } finally {
      await handle.close();
    }
  } catch {
    // Neither filesystem paths nor JSON/validation details may reach the operator response.
    throw new Error("LEGAL_CONTACTS_UNAVAILABLE");
  }
}
