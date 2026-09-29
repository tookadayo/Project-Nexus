export const features=['fallback_onboarding','hybrid_onboarding','custom_activation','connection_metrics','advanced_cohorts','diagnosis','interventions','automation_auto','experiments','ai_explanation','webhooks','api','multi_guild','rbac','audit_export'] as const;
export type Feature=typeof features[number];
export type Plan='FREE'|'STARTER'|'GROWTH'|'SCALE'|'ENTERPRISE';
const free:Feature[]=['fallback_onboarding','hybrid_onboarding','interventions'];
const starter:Feature[]=[...free,'custom_activation','connection_metrics','diagnosis'];
const growth:Feature[]=[...starter,'advanced_cohorts','automation_auto','experiments','ai_explanation','webhooks'];
export const planCurrency='USD' as const;
export const planRegistry:Record<Plan,{price:number|null,included:number|null,guilds:number,features:readonly Feature[]}>={FREE:{price:0,included:250,guilds:1,features:free},STARTER:{price:15,included:1000,guilds:1,features:starter},GROWTH:{price:49,included:5000,guilds:1,features:growth},SCALE:{price:149,included:25000,guilds:5,features},ENTERPRISE:{price:null,included:null,guilds:100,features}};
// A feature flag can reserve an entitlement before the customer-facing workflow ships.
export const featureAvailability:Record<Feature,'available'|'planned'>={fallback_onboarding:'available',hybrid_onboarding:'available',custom_activation:'available',connection_metrics:'available',advanced_cohorts:'available',diagnosis:'available',interventions:'available',automation_auto:'available',experiments:'available',ai_explanation:'planned',webhooks:'planned',api:'planned',multi_guild:'planned',rbac:'planned',audit_export:'planned'};
