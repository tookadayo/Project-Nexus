import {NextResponse} from 'next/server';
import {userFailure} from '../../../../packages/shared/src/errors';
export function authProblem(error:unknown){
 const failure=userFailure(error,'NOT_STARTED',{action:'oauth',stage:'sign-in'}),url=new URL('/auth/problem',process.env.NEXUS_WEB_URL??'http://localhost:3100');
 url.searchParams.set('category',failure.category);if(failure.reference)url.searchParams.set('reference',failure.reference);
 const response=NextResponse.redirect(url);response.cookies.delete('nexus_oauth_state');response.cookies.delete('nexus_oauth_next');return response;
}
