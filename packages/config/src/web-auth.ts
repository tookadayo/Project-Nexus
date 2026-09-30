// Shared by the launcher, Next startup and every authorization entry point.
export function webAuthMode(env:NodeJS.ProcessEnv=process.env):'oauth'|'development'{
 const mode=env.NEXUS_WEB_AUTH_MODE??'oauth';
 if(mode!=='oauth'&&mode!=='development')throw new Error('NEXUS_WEB_AUTH_MODE must be oauth or development');
 if(mode==='development'&&env.NODE_ENV==='production')throw new Error('Development Web authentication is forbidden in production');
 if(mode==='development'&&(env.NEXUS_WEB_PASSWORD?.length??0)<16)throw new Error('NEXUS_WEB_PASSWORD must be at least 16 characters');
 return mode;
}
