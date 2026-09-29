import {createRequire} from 'node:module';
import {ServerCards} from '../../apps/web/app/servers/cards.js';
import type {AuthorizedGuild} from '../../apps/web/app/auth/session.js';

const require=createRequire(import.meta.url);
const {createElement}=require('../../apps/web/node_modules/react/index.js') as typeof import('react');
const {renderToStaticMarkup}=require('../../apps/web/node_modules/react-dom/server.node.js') as typeof import('react-dom/server');
const guilds:AuthorizedGuild[]=[
 {id:'111111111111111111',name:'Game Community',installed:true,installUrl:null,state:'VERIFIED'},
 {id:'222222222222222222',name:'Another Server',installed:false,installUrl:'https://discord.com/oauth2/authorize?client_id=123',state:'NOT_INSTALLED'}
];
process.stdout.write(renderToStaticMarkup(createElement(ServerCards,{locale:'en',guilds})));
