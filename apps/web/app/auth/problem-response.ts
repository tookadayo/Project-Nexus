import {NextResponse} from 'next/server';
import {userFailure} from '../../../../packages/shared/src/errors';
import {webOrigin} from '../../../../packages/config/src/web-origin';
function clearOAuthAttempt(response:NextResponse){
 response.cookies.delete('nexus_oauth_state');response.cookies.delete('nexus_oauth_next');response.cookies.delete('nexus_checkout_login');return response;
}
/** Display-only cancellation on the existing problem page. The callback must
 * validate state before choosing this response. No session is created/revoked. */
export function authCancelled(){
 const url=new URL('/auth/problem',webOrigin());url.searchParams.set('cancelled','1');return clearOAuthAttempt(NextResponse.redirect(url));
}
export function authProblem(error:unknown){
 const failure=userFailure(error,'NOT_STARTED',{action:'oauth',stage:'sign-in'}),url=new URL('/auth/problem',webOrigin());
 url.searchParams.set('category',failure.category);if(failure.reference)url.searchParams.set('reference',failure.reference);
 return clearOAuthAttempt(NextResponse.redirect(url));
}
