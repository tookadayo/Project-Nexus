import {z} from "zod";
const identifier=z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const target=z.object({targetType:identifier,targetId:identifier,liveVersion:identifier}).strict();
export const issueRegistryInput=z.object({id:z.uuid(),expectedVersion:z.number().int().min(0),issueCode:identifier,baseTarget:target,
 experimentIds:z.array(z.uuid()).max(100),playbookIds:z.array(z.uuid()).max(100),experimentsComplete:z.boolean(),playbooksComplete:z.boolean(),validForSeconds:z.number().int().min(1).max(172800),
 inventoryHashes:z.object({experiments:z.string().regex(/^[a-f0-9]{64}$/),playbooks:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict();
export const issueRegistryRemoval=z.object({id:z.uuid(),expectedVersion:z.number().int().positive()}).strict();
