import {FailureNotice} from '../../failure-ui';
import {SiteShell,siteLocale,copy} from '../../public-ui';
import type {UserFailure} from '../../../../../packages/shared/src/error-types';
export default async function AuthProblem({searchParams}:{searchParams:Promise<{category?:string;reference?:string}>}){
 const query=await searchParams,locale=await siteLocale();
 const failure:UserFailure={category:query.category==='WEB_CONNECTION'?'WEB_CONNECTION':query.category==='DISCORD_UNAVAILABLE'?'DISCORD_UNAVAILABLE':'AUTH_SESSION',effect:'NOT_STARTED',...(/^NXS-[A-F0-9]{12}$/.test(query.reference??'')?{reference:query.reference}:{})};
 return <SiteShell locale={locale}><div className="servers-content"><FailureNotice locale={locale} failure={failure}/><a className="button button-primary" href="/auth/login">{copy(locale,'Discordでログイン','Sign in with Discord')}</a></div></SiteShell>;
}
