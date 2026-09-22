import {expect,it} from 'vitest';
import {IdentityVault} from '../../packages/identity/src/index.js';
const vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
const s={organizationId:'00000000-0000-4000-8000-000000000001',guildId:'123456789012345678'};
it('scopes HMAC and authenticated ciphertext to the guild',()=>{
 const other={...s,guildId:'123456789012345679'};
 expect(vault.hash(s,'123456789012345680')).not.toBe(vault.hash(other,'123456789012345680'));
 const sealed=vault.seal(s,'secret');expect(sealed).not.toContain('secret');
 expect(vault.open(s,sealed)).toBe('secret');expect(()=>vault.open(other,sealed)).toThrow();
});
