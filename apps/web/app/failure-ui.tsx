import type {UserFailure} from '../../../packages/shared/src/error-types';
import {failureCopy} from '../../../packages/discord-panels/src/i18n/errors';
export function FailureNotice({failure,locale,onCheck,back='/servers'}:{failure:UserFailure;locale:'ja'|'en';onCheck?:()=>void;back?:string}){
 const copy=failureCopy(locale,failure);return <section className="surface empty-state" role="alert"><h2>{copy.title}</h2><p>{copy.detail}</p><p>{copy.effect}</p>{failure.reference&&<p>{locale==='ja'?'参照ID':'Reference ID'}: <strong>{failure.reference}</strong></p>}{onCheck?<button onClick={onCheck}>{failure.effect==='NOT_STARTED'?(locale==='ja'?'再試行':'Retry'):(locale==='ja'?'最新状態を確認':'Check current state')}</button>:<a className="button button-primary" href={back}>{locale==='ja'?'サーバー一覧へ':'Server list'}</a>}</section>;
}
