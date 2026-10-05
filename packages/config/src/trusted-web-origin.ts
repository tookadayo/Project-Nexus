import { webOrigin } from "./web-origin";
/** Payment URLs never use Host or forwarded headers, including development. */
export function trustedWebOrigin(env: NodeJS.ProcessEnv = process.env) {
  const origin = webOrigin(undefined, env);
  if (env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("BILLING_HTTPS_ORIGIN_REQUIRED");
  return origin;
}
