import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { StaticPublications } from "../../packages/operations/src/alpha16-publication";
import { canonicalPublicJson } from "../../packages/presentation/src/alpha16-publication";

/** Server-side composition helper. No ENV/DB/credential/candidate loader is
 * imported. A reviewed composition must supply the already authorized service.
 * The output is exclusive and contains only its confirmed public projection. */
export async function exportConfirmedOfficialInput(service: StaticPublications,
  input: Parameters<StaticPublications["exportConfirmedPublicInput"]>[0], outputPath: string) {
  const publicInput = await service.exportConfirmedPublicInput(input);
  const bytes = canonicalPublicJson(publicInput);
  await writeFile(outputPath, bytes, { flag: "wx", encoding: "utf8" });
  return { published: false, announcementCount: publicInput.announcements.length,
    inputSha256: createHash("sha256").update(bytes).digest("hex") };
}
