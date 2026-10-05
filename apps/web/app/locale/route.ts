import {NextRequest,NextResponse} from 'next/server';
import {webOrigin} from '../../../../packages/config/src/web-origin';
export async function POST(request:NextRequest){
 const data=await request.formData();const locale=data.get('locale');
 if(locale!=='ja'&&locale!=='en')return new NextResponse('Invalid locale',{status:400});
 const canonical=webOrigin(request),origin=request.headers.get('origin');const destination=origin&&origin===canonical?request.headers.get('referer'):null;
 let url=canonical;try{if(destination&&new URL(destination).origin===canonical)url=destination;}catch{/* Malformed return URLs fall back to the trusted origin. */}
 const response=NextResponse.redirect(url,{status:303});response.cookies.set('nexus_locale',locale,{path:'/',sameSite:'lax',maxAge:31536000});return response;
}
