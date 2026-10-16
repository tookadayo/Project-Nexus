import type {OperationalSourcePlugin} from "./operational-context-sources";
import {createCase01To12SourcePlugin} from "./operational-case-01-12-sources";
import {createRoleAccessSourcePlugin} from "./role-access-source";
import {createOperationalNativeContextPlugin} from "./operational-context-native";
/** Registered server readers only; browser descriptors cannot add a plugin. */
export function operationalContextPlugins(): readonly OperationalSourcePlugin[] {return [createCase01To12SourcePlugin(), createRoleAccessSourcePlugin(), createOperationalNativeContextPlugin()];}
