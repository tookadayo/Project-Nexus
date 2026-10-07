import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
const login = z
  .object({
    kind: z.literal("CHECKOUT_LOGIN"),
    offeringId: z.uuid(),
    state: z.string().min(16).max(128),
    nonce: z.uuid(),
    issuedAt: z.number(),
    expiresAt: z.number(),
  })
  .strict();
const receipt = z
  .object({
    kind: z.literal("CHECKOUT_RECEIPT"),
    operationId: z.uuid(),
    offeringId: z.uuid(),
    guildId: z.string().regex(/^\d{17,20}$/),
    userId: z.string().regex(/^\d{17,20}$/),
    issuedAt: z.number(),
    expiresAt: z.number(),
  })
  .strict();
type Intent = z.infer<typeof login> | z.infer<typeof receipt>;
const key = () => {
  const secret = process.env.NEXUS_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("SESSION_CONFIGURATION_REQUIRED");
  return createHash("sha256").update(secret).digest();
};
function seal(value: Intent) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from("nexus:checkout-intent:v1"));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
function open(value: string | undefined): Intent | null {
  if (!value || value.length > 4096) return null;
  try {
    const bytes = Buffer.from(value, "base64url"),
      decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from("nexus:checkout-intent:v1"));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const parsed = z
      .discriminatedUnion("kind", [login, receipt])
      .parse(
        JSON.parse(
          Buffer.concat([
            decipher.update(bytes.subarray(28)),
            decipher.final(),
          ]).toString(),
        ),
      );
    const ttl = parsed.kind === "CHECKOUT_LOGIN" ? 600000 : 86400000;
    if (
      parsed.issuedAt > Date.now() ||
      parsed.expiresAt <= Date.now() ||
      parsed.expiresAt - parsed.issuedAt !== ttl
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
export function checkoutLoginIntent(offeringId: string, state: string) {
  const issuedAt = Date.now();
  return seal(
    login.parse({
      kind: "CHECKOUT_LOGIN",
      offeringId,
      state,
      nonce: randomUUID(),
      issuedAt,
      expiresAt: issuedAt + 600000,
    }),
  );
}
export function checkoutLoginOffering(
  value: string | undefined,
  state: string | null,
) {
  const intent = open(value);
  return intent?.kind === "CHECKOUT_LOGIN" && intent.state === state
    ? intent.offeringId
    : null;
}
export function checkoutReceipt(
  input: Pick<
    z.infer<typeof receipt>,
    "operationId" | "offeringId" | "guildId" | "userId"
  >,
) {
  const issuedAt = Date.now();
  return seal(
    receipt.parse({
      ...input,
      kind: "CHECKOUT_RECEIPT",
      issuedAt,
      expiresAt: issuedAt + 86400000,
    }),
  );
}
export function openCheckoutReceipt(value: string | undefined) {
  const intent = open(value);
  return intent?.kind === "CHECKOUT_RECEIPT" ? intent : null;
}
