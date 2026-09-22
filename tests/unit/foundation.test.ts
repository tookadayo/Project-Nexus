import {expect,it} from 'vitest';
import {scopeSchema} from '../../packages/shared/src/index.js';
import {configSchema} from '../../packages/config/src/index.js';
it('requires explicit organization and guild scope',()=>{
  expect(scopeSchema.safeParse({guildId:'123456789012345678'}).success).toBe(false);
});
it('rejects missing credentials without exposing them',()=>{expect(configSchema.safeParse({}).success).toBe(false);});
