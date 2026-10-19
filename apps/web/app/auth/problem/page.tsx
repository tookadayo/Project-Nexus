import {FailureNotice} from '../../failure-ui';
import {SiteShell,siteLocale,copy} from '../../public-ui';
import type {UserFailure,ErrorCategory} from '../../../../../packages/shared/src/error-types';
export default async function AuthProblem({searchParams}:{searchParams:Promise<{category?:string;reference?:string;cancelled?:string}>}){
 const query=await searchParams,locale=await siteLocale();
 if(query.cancelled==='1')return <SiteShell locale={locale}><div className="servers-content"><section className="surface empty-state" role="status"><h1>{copy(locale,'ログインをキャンセルしました','Sign-in canceled')}</h1><p>{copy(locale,'新しいログインセッションは作成していません。必要なときにもう一度ログインできます。','No new login session was created. You can sign in again when you are ready.')}</p><a className="button" href="/">{copy(locale,'ホームへ戻る','Back to home')}</a></section><a className="button button-primary" href="/auth/login">{copy(locale,'Discordでログイン','Sign in with Discord')}</a></div></SiteShell>;
 const allowed=['AUTH_SESSION','WEB_CONNECTION','DISCORD_TIMEOUT','DISCORD_RATE_LIMIT','DISCORD_UNAVAILABLE','INTERNAL','DATABASE_FAILURE','PERMISSION'];
 const failure:UserFailure={category:allowed.includes(query.category??'')?query.category as ErrorCategory:'AUTH_SESSION',effect:'NOT_STARTED',...(/^NXS-[A-F0-9]{12}$/.test(query.reference??'')?{reference:query.reference}:{})};
 return <SiteShell locale={locale}><div className="servers-content"><FailureNotice locale={locale} failure={failure}/><a className="button button-primary" href="/auth/login">{copy(locale,'Discordでログイン','Sign in with Discord')}</a></div></SiteShell>;
}
