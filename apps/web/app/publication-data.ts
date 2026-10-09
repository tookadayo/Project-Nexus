import "server-only";
import { connection } from "next/server";
import { connect } from "../../../packages/db/src/index";
import { OfficialPublications } from "../../../packages/operations/src/publication";

export type PublicationRead<T> =
  { state: "ready"; data: T } | { state: "unavailable" };

// No shared cache or draft accessor: every request resolves the current published
// pointer. A missing database or failed read must not masquerade as an empty list.
async function readPublication<T>(
  read: (publications: OfficialPublications) => Promise<T>,
): Promise<PublicationRead<T>> {
  await connection();
  if (!process.env.DATABASE_URL) return { state: "unavailable" };
  let db: ReturnType<typeof connect> | undefined;
  try {
    db = connect(process.env.DATABASE_URL);
    return { state: "ready", data: await read(new OfficialPublications(db)) };
  } catch {
    // Database errors can contain deployment details. Public output stays generic.
    return { state: "unavailable" };
  } finally {
    try {
      await db?.destroy();
    } catch {
      // Do not surface connection details while closing a failed read.
    }
  }
}

export function publicNewsList(
  input: Parameters<OfficialPublications["publicList"]>[0],
) {
  return readPublication((publications) => publications.publicList(input));
}

export function publicNewsDetail(id: string, locale: "ja" | "en") {
  return readPublication((publications) =>
    publications.publicDetail(id, locale),
  );
}
