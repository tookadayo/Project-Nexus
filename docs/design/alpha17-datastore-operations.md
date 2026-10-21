# alpha17 production datastore operations

## Current status

The preparation checkpoint below records the initial 2026-10-18 state. Subsequent user-approved WSL/Docker setup and isolated synthetic PostgreSQL tests are recorded in the current [PC setup status](alpha17-pc-setup-status.md) and [integration validation status](alpha17-integration-validation-status.md). Production activation, credential/ACL setup, migrations and recovery remain separate, uncompleted acceptance work. Local test success does not establish production readiness.

## Preparation checkpoint (historical)

Prepared 2026-10-18 from checkpoint `8d23caeacecd6b09672f5f8a5ef6901ad1e9271c` and [the alpha17 operations plan](alpha17-operations-plan.md). This document and the Compose file are preparation only. Docker license acceptance, credentials, host ACLs, live containers, volumes, application authentication, production migrations and recovery have not been exercised here. Later PC setup enabled the WSL optional feature (DISM 3010, restart required); VirtualMachinePlatform was cancelled at Windows UAC and remains disabled, and the WSL MSI/reboot are not performed. See the current [PC setup status](alpha17-pc-setup-status.md). Docker Desktop license acceptance remains separate.

## Isolated production configuration

Use **only** `infra/docker/compose.production.yaml`, as a standalone Compose file. Never merge it with the development `compose.yaml`, and never run `NEXUS SETUP.cmd` or the existing development START for production. Those paths use portable test infrastructure, generate credentials, migrate on startup and/or run Next development mode. The production launcher owns application readiness; this file starts no NEXUS application or Operator and runs no NEXUS migration.

The images are official `postgres:18.6-trixie` and `redis:8.10.2-trixie`, pinned to the manifest-list digests returned by Docker Hub's public tags API on 2026-10-18, with `platform: linux/amd64`:

| Image | Manifest-list digest | Linux/amd64 image digest |
| --- | --- | --- |
| postgres:18.6-trixie | `sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336` | `sha256:885953109528ad3dfc90362b1a6f50a78620b5315be19f187753d267e484dc5b` |
| redis:8.10.2-trixie | `sha256:2c2dff791878316e3b083188be0d578423b24813cdda5de0e80ea4f7b3e6bfd6` | `sha256:6e9101032a2126aeeb4b1e862ac77d2fcf26b831ae37e5ff2e69169f82ddd411` |

Metadata: [PostgreSQL tag](https://hub.docker.com/v2/repositories/library/postgres/tags/18.6-trixie), [Redis tag](https://hub.docker.com/v2/repositories/library/redis/tags/8.10.2-trixie). Digest verification is metadata evidence, not a successful image pull or runtime test.

Host listeners stay at `127.0.0.1:55432` and `127.0.0.1:56379`. The Redis container binds its container interface to support this Docker forwarding; the host publication remains loopback. Do not add either datastore to Tunnel, public proxy, LAN bind or firewall exceptions. API and Operator also stay outside public ingress.

Production volumes are separately named `nexus-production-postgres-18` and `nexus-production-redis-8`. PostgreSQL 18 uses `PGDATA=/var/lib/postgresql/18/docker` and the volume mount `/var/lib/postgresql`; do not substitute the pre-18 mount path. Do not reuse, delete, import or automatically upgrade a development volume. Initial bootstrap creates the `nexus_owner` database owner; this is not a least-privilege application role.

## Required local inputs

`infra/docker/production.env.example` contains only empty non-secret settings. Do not create a root `.env`. A later approved configuration must live outside the checkout, under the separately protected local configuration area described by the operations plan.

Set every listed resource value explicitly from an approved operating profile. CPU, memory, PID count, shared memory, log size/file count and Redis maxmemory must be finite and positive; zero, negative and unlimited settings are not approved. Redis maxmemory is integer bytes and must leave approved overhead below its container memory limit. Matching `memswap_limit` and `mem_limit` disables container swap. Compose rejects absent/empty settings; this required interpolation is not proof that arbitrary supplied values have been approved. Validate the values and the WSL/host-wide limits before activation.

The two secret settings are **absolute paths** to non-empty, owner-protected regular files outside Git/checkouts and web distribution:

- `NEXUS_PRODUCTION_POSTGRES_PASSWORD_FILE`: the PostgreSQL bootstrap owner's password, read by the image using `POSTGRES_PASSWORD_FILE`. No default password is supplied. Configure the application's protected `DATABASE_URL` separately; changing the bootstrap file on an existing volume does not rotate an existing database password.
- `NEXUS_PRODUCTION_REDIS_ACL_FILE`: a Redis ACL file. It must contain exactly one `user default off` rule, no `nopass` or plaintext `>password` tokens, and an explicitly provisioned application user with hashed password and the approved command/key/channel permissions. The bootstrap checks the disabled default and rejects password-free/plaintext rules; Redis validates the complete ACL grammar. No credential or hash is generated by this work. Configure the application's protected `REDIS_URL` separately.

Local Compose file secrets are read-only file mounts, not an encrypted secret manager or evidence of Windows owner-only ACLs. Do not rely on Compose `uid/gid/mode` to protect the host source file. Verify host ownership/ACLs, symlink/reparse boundaries and Docker's ability to read the files in the separately authorized credential step. Secret mounts are read-only; unreadable files must fail rather than broadening host access. Container data-volume ownership changes by the official entrypoints do not establish host secret-file ACLs.

## Staged activation and checks

After Docker terms, WSL readiness, protected inputs and explicit activation approval are complete:

1. Validate the standalone Compose configuration with the external settings file, without printing it into logs. For example, from the repo root: `docker compose --env-file <absolute-external-settings-file> -f infra/docker/compose.production.yaml config --quiet`. This validates interpolation/schema, not host ACLs, secret contents, resource approval or application access.
2. Pull the pinned images and explicitly start the two datastores. Container creation, initial database creation and volume creation are separate from this preparation.
3. Verify loopback publication, actual image/platform/digests, volume ownership, resource limits and bounded log rotation. PostgreSQL health is only server readiness. Redis health requires an unauthenticated `PING` to receive `NOAUTH`; it means the server is alive and refusing that request. It is **not** authenticated application readiness. An unexpected `PONG` is unhealthy.
4. Separately verify application PostgreSQL authentication/schema and Redis authentication plus the actual BullMQ/Lua/Streams/retention commands under the intended ACL. Keep the production app closed if any of these fail. Apply migrations only in the explicitly approved migration step; normal production start must not migrate.
5. Test normal stop, crash and reboot recovery, including the application's bounded retries. Set the required `NEXUS_PRODUCTION_DATASTORE_RESTART_POLICY` explicitly after approval. The first candidate for these datastores is `unless-stopped`: it keeps a manually stopped container stopped and aims to restart running containers when the Docker daemon returns, but crash retries are not finite. If finite crash retry is required instead, use an explicitly approved `on-failure:N`; Docker does not automatically restart that policy on daemon/OS return. No fixed retry count has been measured or adopted here. Either policy is not a guarantee of recovery before Windows sign-in: Docker Desktop itself must first be available. No automatic Windows login is adopted.
6. Establish encrypted off-host backups, separately protected keys, the seven-day recovery-copy maximum, latest deletion/safety records and an isolated restore drill before production acceptance. Named volumes and AOF are persistence, not a backup or stopped-PC retention guarantee.

No real `up`, volume creation, authentication, migration, ACL/service/firewall change or backup/restore was performed for this preparation. Configuration parsing and synthetic checks cannot certify Windows/Docker runtime behavior.

## Official references

- [Docker Desktop Windows requirements and download](https://docs.docker.com/desktop/setup/install/windows-install/) and [license terms](https://docs.docker.com/subscription-billing/desktop-license/): Home uses Linux containers; free use is conditional on personal/education/noncommercial OSS or qualifying small-business use.
- [Microsoft WSL installation](https://learn.microsoft.com/en-us/windows/wsl/install): initial enablement requires an administrator operation and restart.
- [PostgreSQL official image](https://hub.docker.com/_/postgres): PostgreSQL 18 volume layout, initialization-only environment settings and password file support.
- [Redis official image](https://hub.docker.com/_/redis): image security and permission behavior; [Redis ACLs](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/).
- [Compose file secrets](https://docs.docker.com/reference/compose-file/services/#secrets) and [restart policy behavior](https://docs.docker.com/engine/containers/start-containers-automatically/).

## Preparation verification (2026-10-18)

- PASS: existing YAML 2.9.1 parsed the standalone file; 13 mandatory input keys matched the empty non-secret example; loopback ports, official tag/digest syntax, secret-file references, explicit resource/restart inputs, PostgreSQL 18 layout and separate volume names were checked.
- PASS: Redis bootstrap POSIX-shell syntax, seven synthetic ACL cases (including CRLF, enabled/missing/duplicate default, password-free/plaintext rejection), and four synthetic health responses (NOAUTH accepted; PONG, empty and WRONGPASS rejected). The tests emitted no fixture contents and used no real credentials or datastore process.
- NOT RUN: Docker Compose config/up, image pull, container/volume creation, host secret ACLs, authenticated application PostgreSQL/Redis access, migration or reboot/backup/restore. Docker CLI/Desktop is not installed for this check, Docker terms are not accepted, and WSL2 readiness remains unverified; see the partial feature activation in the PC setup status. YAML/synthetic results are not Docker runtime evidence.
- The existing development Compose, root package.json and lockfile were not modified by this task. No commit was created.
