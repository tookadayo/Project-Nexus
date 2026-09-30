import {NextResponse} from 'next/server';
import {userFailure} from '../../../../packages/shared/src/errors';
import {isDomainError} from '../../../../packages/shared/src/index';
import type {FailureEffect} from '../../../../packages/shared/src/error-types';
export function failureResponse(error:unknown,effect:FailureEffect='UNKNOWN'){
 const failure=userFailure(error,effect,{action:'web',stage:'route'}),status=isDomainError(error)?error.status:failure.category==='AUTH_SESSION'?401:failure.category==='PERMISSION'?403:failure.category==='VALIDATION'?400:failure.category==='REVISION_CONFLICT'?409:503;
 return NextResponse.json({error:isDomainError(error)?error.code:failure.category,failure},{status,headers:{'Cache-Control':'no-store'}});
}
