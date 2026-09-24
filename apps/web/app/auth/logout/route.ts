import {NextResponse} from 'next/server';
export async function GET(){const response=NextResponse.redirect(new URL('/auth/login',process.env.NEXUS_WEB_URL??'http://localhost:3100'));response.cookies.delete('nexus_session');response.cookies.delete('nexus_guild');return response;}
