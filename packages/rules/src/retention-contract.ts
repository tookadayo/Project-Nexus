/** User-delegated retention selection, received 2026-10-16. This declaration
 * is source policy only: importing it performs no writes or runtime activation. */
export const ALPHA16_RETENTION_CONTRACT=Object.freeze({
 revision:"alpha16-retention-2026-10-16",
 factSnapshot:{maximumSeconds:48*60*60,anchor:"CREATED_OR_SEALED",sourceExpiryWins:true},
 evaluation:{maximumSeconds:48*60*60,anchor:"CREATED_OR_SEALED",sourceExpiryWins:true},
 sourceHealthSnapshot:{maximumSeconds:48*60*60,anchor:"CREATED_OR_SEALED",sourceExpiryWins:true},
 evidence:{maximumSeconds:48*60*60,anchor:"CREATED_OR_SEALED",sourceExpiryWins:true},
 minimalSuggestionHistory:{maximumSeconds:14*24*60*60,anchor:"SUGGESTION_CREATED"},
 minimalOperationAudit:{maximumSeconds:14*24*60*60,anchor:"OPERATION"},
 lineageSuppression:{maximumSeconds:14*24*60*60,anchor:"USER_CHOICE"},
 deletionReceipt:{maximumSeconds:14*24*60*60,anchor:"DELETION_ACCEPTED"},
 runDerived:{maximumSeconds:7*24*60*60,anchor:"FIRST_TERMINAL"},
 backup:{maximumSeconds:7*24*60*60,anchor:"BACKUP_CREATED"},
 targetLiveSafety:{status:"LIFETIME_UNRESOLVED",onMissing:"FAIL_CLOSED"},
 restoreTombstone:{status:"LIFETIME_UNRESOLVED",onMissing:"RESTORE_BLOCKED"},
 publicationWithdrawal:{status:"LIFETIME_UNRESOLVED",onMissing:"PUBLISH_BLOCKED"},
 runtimeEnabled:false,
} as const);
