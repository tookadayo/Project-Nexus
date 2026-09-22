import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
const packages=['config','db','discord','discord-panels','events','identity','lifecycle','onboarding','settings','analytics','security','shared'];
const apps=['gateway','interaction','api','worker','web'];
for(const [kind,names] of [['packages',packages],['apps',apps]]) for(const name of names){
 const dir=`${kind}/${name}`;mkdirSync(`${dir}/src`,{recursive:true});
 const path=`${dir}/package.json`;
 if(!existsSync(path)) writeFileSync(path,JSON.stringify({name:`@nexus/${name}`,version:'0.1.0',private:true,type:'module',scripts:{build:name==='web'?'next build':'tsc --noEmit -p ../../tsconfig.json'}},null,2)+'\n');
}
