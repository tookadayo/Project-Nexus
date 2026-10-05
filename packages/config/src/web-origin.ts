type OriginRequest = { url?: string; headers?: Pick<Headers, "get"> };

function canonicalOrigin(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("NEXUS_WEB_URL must be an absolute HTTP(S) origin");
  return url.origin;
}

// Production URLs have one trusted source. Request headers are used only by
// local development, never to construct OAuth or public metadata in production.
export function webOrigin(
  request?: OriginRequest,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.NEXUS_WEB_URL) return canonicalOrigin(env.NEXUS_WEB_URL);
  if (env.NODE_ENV === "production")
    throw new Error("NEXUS_WEB_URL is required in production");
  if (request?.url) return new URL(request.url).origin;
  const host = request?.headers?.get("host") ?? "localhost:3100";
  const protocol =
    request?.headers?.get("x-forwarded-proto") === "https" ? "https" : "http";
  return canonicalOrigin(`${protocol}://${host}`);
}
