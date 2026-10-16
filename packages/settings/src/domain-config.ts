import {z} from 'zod';
import {activationSchema} from '../../lifecycle/src/activation';
import {interventionSchema} from '../../lifecycle/src/interventions';
import {experimentSchema} from '../../lifecycle/src/experiments';
import {RevisionService,type ConfigDomain} from './revisions';
import {settingsSchema} from './index';
import type {Database} from '../../db/src/index.js';
export const onboardingConfigSchema=settingsSchema.pick({onboardingMode:true,hybrid:true});
export const privacyConfigSchema=settingsSchema.pick({detailedRetentionDays:true,aggregateRetentionMonths:true,dmEnabled:true});
export function domainRevisions(db:Database){return new RevisionService(db,{activation:activationSchema,intervention:interventionSchema,experiment:experimentSchema,onboarding:onboardingConfigSchema,privacy:privacyConfigSchema,cohort:z.object({name:z.string().max(100)}).strict()});}
export const configDomains:ConfigDomain[]=['activation','intervention','experiment','onboarding','privacy'];
