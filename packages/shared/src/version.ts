import manifest from '../../../package.json';

/** package.json is the single release-version source. */
export const VERSION=manifest.version;
export const RELEASE_CHANNEL=VERSION.includes('-alpha.')?'Alpha':VERSION.includes('-beta.')?'Beta':VERSION.includes('-rc.')?'Release candidate':'Stable';
export const shortSha=(value:string|undefined)=>/^[0-9a-f]{7,40}$/i.test(value??'')?value!.slice(0,7).toLowerCase():'unknown';
export const buildLabel=(sha:string|undefined)=>shortSha(sha)==='unknown'?VERSION:`${VERSION}+g${shortSha(sha)}`;
