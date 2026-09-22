export const colors={
 nexus:0x5865f2,
 healthy:0x3ba55d,
 collecting:0xfee75c,
 warning:0xf0b232,
 critical:0xed4245,
 neutral:0x4e5058
} as const;

export type Accent=keyof typeof colors;
