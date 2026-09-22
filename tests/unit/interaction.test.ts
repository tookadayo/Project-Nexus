import {expect,it} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyInteraction,scopeForGuild,canAdmin} from '../../packages/security/src/index.js';
it('validates exact bytes, fresh timestamp and Ed25519 signature',()=>{
 const {publicKey,privateKey}=generateKeyPairSync('ed25519');const pub=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const ts=String(Math.floor(Date.now()/1000));const body=Buffer.from('{"type":1}');const sig=sign(null,Buffer.concat([Buffer.from(ts),body]),privateKey).toString('hex');
 expect(verifyInteraction(pub,sig,ts,body)).toBe(true);expect(verifyInteraction(pub,sig,ts,Buffer.from('{}'))).toBe(false);
 expect(verifyInteraction(pub,sig,ts,body,Date.now()+600000)).toBe(false);
});
it('requires admin privilege and produces guild-specific scope',()=>{
 expect(canAdmin('0',[],null)).toBe(false);expect(canAdmin('32',[],null)).toBe(true);
 expect(scopeForGuild('123456789012345678')).not.toEqual(scopeForGuild('123456789012345679'));
});
