import {ButtonStyle} from 'discord-api-types/v10';
import {discordLabel,t,type MessageKey,type UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,footer,nexusPanel,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export type ErrorKind='revision'|'permission'|'entitlement'|'generic';
export async function errorPanel(issue:Issue,kind:ErrorKind='generic',locale:UiLocale='en',reference='NXS-000000'):Promise<Panel>{
 const keys:Record<ErrorKind,[MessageKey,MessageKey]>={revision:['error.revisionTitle','error.revisionDetail'],permission:['error.permissionTitle','error.permissionDetail'],entitlement:['error.entitlementTitle','error.entitlementDetail'],generic:['error.genericTitle','error.genericSubtitle']},[title,subtitle]=keys[kind];
 return nexusPanel({title:t(locale,title),subtitle:t(locale,subtitle),accent:'critical',children:[divider(),callout(t(locale,'error.possible'),t(locale,'error.causes')),callout(t(locale,'error.safe'),kind==='generic'?t(locale,'error.unknownState'):t(locale,'error.notCommitted')),callout(t(locale,'error.ref'),`**${reference}**`),footer(t(locale,'error.footer'))],rows:[await actionRow(issue,[{label:discordLabel(locale,'error.openPanel'),action:'panel',style:ButtonStyle.Primary},{label:discordLabel(locale,'error.runDiagnostics'),action:'status'},{label:discordLabel(locale,'common.back'),action:'settings'}])]});
}
