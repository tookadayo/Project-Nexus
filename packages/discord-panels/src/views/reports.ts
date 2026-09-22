import {discordLabel,t,type UiLocale} from '../i18n/index.js';
import {actionRow,callout,divider,emptyState,nexusPanel,type Panel} from '../primitives.js';
import type {Issue} from '../types.js';
export async function reportsPanel(issue:Issue,locale:UiLocale='en'):Promise<Panel>{return nexusPanel({title:t(locale,'reports.title'),subtitle:t(locale,'reports.subtitle'),children:[divider(),emptyState(t(locale,'reports.later'),t(locale,'reports.laterDetail')),callout(t(locale,'reports.now'),t(locale,'reports.nowDetail'))],rows:[await actionRow(issue,[{label:discordLabel(locale,'common.overview'),action:'overview'},{label:discordLabel(locale,'common.lifecycle'),action:'lifecycle'}])]});}
