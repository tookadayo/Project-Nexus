import {NextRequest,NextResponse} from 'next/server';
export async function POST(request:NextRequest){
 const data=await request.formData();const locale=data.get('locale');
 if(locale!=='ja'&&locale!=='en')return new NextResponse('Invalid locale',{status:400});
 const origin=request.headers.get('origin');const destination=origin&&origin===request.nextUrl.origin?request.headers.get('referer'):null;
 const url=destination&&destination.startsWith(request.nextUrl.origin)?destination:request.nextUrl.origin;
 const response=NextResponse.redirect(url,{status:303});response.cookies.set('nexus_locale',locale,{path:'/',sameSite:'lax',maxAge:31536000});return response;
}
