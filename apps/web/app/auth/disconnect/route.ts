import { NextRequest, NextResponse } from "next/server";
import { openSession, validateOAuthSession } from "../session";
import { publicSessions } from "../public-session-store";
import { sameOrigin } from "../origin";
import { failureResponse } from "../failure-response";
import { DomainError } from "../../../../../packages/shared/src/index";
const html = (text: string) =>
  new NextResponse(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NEXUS</title><main>${text}</main></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
export async function GET() {
  return html(
    '<h1>個人の接続を解除 / Disconnect your account</h1><p>あなたの公開ログイン、保存したDiscord tokenとログイン情報を消去します。他の管理者、サーバーの利用権・データは変更しません。サーバー全体の解除・削除はサーバー画面から行ってください。 / Removes your public sessions, saved Discord tokens and login identity. Other administrators and server access or data are kept. Unlink or delete a whole server from its server page.</p><form method="post"><input type="hidden" name="confirmation" value="disconnect-personal"><button>個人の接続を解除 / Disconnect my account</button></form><a href="/servers">戻る / Back</a>',
  );
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return failureResponse(
      new DomainError("ORIGIN_REJECTED", 403),
      "NOT_STARTED",
    );
  try {
    const text = await req.text();
    if (
      text.length > 256 ||
      new URLSearchParams(text).get("confirmation") !== "disconnect-personal"
    )
      throw new DomainError("INVALID_REQUEST", 400);
    const session = await openSession(req.cookies.get("nexus_session")?.value);
    if (!session) throw new DomainError("SESSION_EXPIRED", 401);
    await validateOAuthSession(session);
    // Local revocation is durable before any provider call. Provider revocation
    // intentionally affects this person's OAuth grant, never a Guild's grants.
    await publicSessions().revokeUser(session.userId);
    let providerRevoked = false;
    try {
      const id = process.env.DISCORD_APPLICATION_ID,
        secret = process.env.DISCORD_CLIENT_SECRET;
      if (id && secret) {
        const response = await fetch(
          "https://discord.com/api/v10/oauth2/token/revoke",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              token: session.accessToken,
              token_type_hint: "access_token",
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(8000),
          },
        );
        providerRevoked = response.ok;
      }
    } catch {
      /* Local revocation is complete; an uncertain provider result is not retried. */
    }
    const response = html(
      providerRevoked
        ? '<h1>個人の接続を解除しました / Account disconnected</h1><a href="/auth/login">ログイン / Sign in</a>'
        : '<h1>保存したログイン情報を消去しました / Saved login removed</h1><p>Discord側の解除は確認できませんでした。Discordの「認証済みアプリ」からNEXUSを解除してください。 / Provider revocation could not be confirmed. Remove NEXUS in Discord Authorized Apps.</p><a href="/auth/login">ログイン / Sign in</a>',
    );
    for (const name of [
      "nexus_session",
      "nexus_guild",
      "nexus_oauth_state",
      "nexus_oauth_next",
      "nexus_checkout_login",
      "nexus_checkout_receipt",
    ])
      response.cookies.delete(name);
    return response;
  } catch (error) {
    return failureResponse(error, "NOT_STARTED");
  }
}
