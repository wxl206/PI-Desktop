# ADR 0347: Main-owned integration with the first-party Iterate gateway

- Status: Accepted for implementation
- Date: 2026-11-14
- Deciders: PI-Desktop Iterate fork maintainers
- Related: [ADR 0012](0012-universal-provider-model-coverage.md) ·
  [ADR 0304](0304-user-supplied-endpoint-trust.md) ·
  [ADR 0243](0243-skill-market-public-https-catalog.md) ·
  [03-runtime/01-ipc-protocol](../spec/03-runtime/01-ipc-protocol.md) ·
  [03-runtime/14-secrets-storage](../spec/03-runtime/14-secrets-storage.md) ·
  [05-security/01-security](../spec/05-security/01-security.md)

## Context

The Iterate fork needs a first-class account path: users should sign in, inspect
their balance, recharge, redeem credit, create a dedicated model key, and
select a model without copying credentials from the website into Settings.
Changing the deployed New API server, portal, payment configuration, groups, or
database is outside the client task.

The existing provider and secret boundaries already protect model credentials,
but a browser session token has a different lifecycle. It must not become a
renderer DTO, a provider secret, or an account-journal field.

## Decision

1. **Fixed-origin Main transport.** Electron Main talks only to
   `https://api.wxl206.xyz`. Login uses an isolated persistent website session;
   the website access token stays in Main memory and is used only for bounded,
   fixed-origin HTTP requests. The renderer receives account metadata only.
2. **Dedicated model key.** Discovery and connection reconcile one uniquely
   named key per `(user, group)` through the gateway API. The API key value
   enters the existing Host provider-secret store and is never returned by the
   account IPC surface. Explicit key rotation creates a new name and rebinds
   only provider rows recorded for that account record; the previous remote key
   is left for the user to inspect or revoke in the Iterate console. The journal
   persists `rotationPending` before recreation, so a failed discovery or
   Provider rebind retries the same remotely created key instead of minting a
   second replacement.
3. **Versioned Host journal.** Rust Host owns a CAS-protected
   journal under the stable `iterate-account-v1` storage key. Version 2 carries
   the active user, per-user `redemptionUsers`, account/group key identities,
   rotation state, and managed Provider bindings. A version 1 singleton
   `redemptionUser` migrates into that array and old records gain
   `rotationPending: false`. The journal contains no website token, cookie, or
   model API key. The Host rejects duplicate account/group and key/name records,
   duplicate redemption users, key, Provider, or Provider-style identities, and
   impossible state/token pairs.
4. **Account/provider transitions.** Switching accounts disables the old
   account's managed Provider rows, commits the new active user, and then
   enables only the new account's verified rows. Provider identity checks
   require the Iterate vendor key, fixed base URL, expected API style, and no
   plugin owner, so a damaged journal cannot mutate an unrelated Provider.
5. **Turn admission.** Model connection, account switching, sign-out, and key
   rotation fail closed while a local turn is running. A shared admission gate
   serializes the final prompt, manual compaction, and approved-plan admission
   window against those operations, so Provider resolution cannot race a
   transition. Session recovery reconciles Provider rows only through the same
   gate and leaves them unchanged while a turn is active.
6. **Isolated account windows.** Login and console use one persistent isolated
   website partition. Recharge uses a separate non-persistent partition and
   opens the third-party shop only after an explicit confirmation. Both
   windows deny permissions, downloads, popups, webviews, DevTools, and
   navigation away from their approved HTTPS origins. These channels are
   available only to the main window and cannot route to a paired remote Host.
7. **Recovery and uncertainty.** Key creation is reconciled by name before a
   retry, so a lost response does not automatically post a duplicate. A
   redemption whose outcome is uncertain blocks automatic retry until the user
   acknowledges the recorded uncertainty.

## Consequences

- The first-party account flow remains a client integration. No server
  deployment, payment, channel, group, or database contract is changed.
- Main and Host gain additive IPC/RPC surfaces and schemas; older provider APIs
  remain unchanged.
- The Iterate website login UI and public API remain compatibility dependencies.
  A breaking website contract requires a new client adaptation and tests.
- Rotation intentionally leaves the previous remote key present. This favors
  recovery and user control over automatically deleting a potentially shared
  credential.
- The version 1 storage-key spelling is retained intentionally; changing it
  would strand valid local account state. Compatibility depends on the version
  field in the value rather than the key name.
- Native Pi sessions and unrelated providers are outside this account journal;
  their existing storage and execution ownership are unchanged.
