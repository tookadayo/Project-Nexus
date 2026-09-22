# ADR 0001: Initial Discord data and permission boundary

Status: initial baseline derived from the user-authorized vertical slice.

Intents: Guilds, GuildMembers, GuildMessages. Permissions: ViewChannel, SendMessages, ManageRoles. Persist configured guild/channel/role/message IDs only for scoped operational purposes. Discord user IDs exist only as guild-keyed HMACs and encrypted vault ciphertext. Lifecycle tables reference internal identity and episode UUIDs.

Discard content, embeds, attachments, DM events, usernames and responder identities before any queue or storage boundary. No raw Discord payload storage. Operational normalized events expire within 24 hours; detailed lifecycle data within 45 days. Aggregates contain no individual identifiers.

Future additions to this baseline require an Architecture Review issue before implementation, including new intents, permissions, persistent identifiers, individual data or longer retention. AI and experiments are outside this slice.
