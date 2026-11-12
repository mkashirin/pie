# OpenAI Multi reference

Operational and maintenance contracts for [OpenAI Multi](../README.md). Selection is explicit,
per-session and provider-specific. There is no rotation, quota detection, retry with another
identity, API-key import, implicit activation or native OpenAI credential fallback.

## Selection and commands

All actions are prefixed by `/openai-accounts`:

| Action                          | Effect / boundary                                                     |
| ------------------------------- | --------------------------------------------------------------------- |
| (no arguments)                  | TUI picker with Add account; selecting an account opens actions only. |
| `add "Work Team"`               | Native interactive OAuth; save without selecting.                     |
| `list`                          | Local labels/UUIDs/expiry; selected marked `*`; no network refresh.   |
| `status`                        | Local selection/expiry, without refreshing credentials.               |
| `use "Work Team"`               | Validate native OAuth authorization, then persist selection.          |
| `clear`                         | Persist an explicitly empty selection.                                |
| `rename "Work Team" "Personal"` | Change label; retain UUID and selection.                              |
| `reauth "Personal"`             | Native login replacing credentials; retain UUID and selection.        |
| `remove "Personal"`             | TUI-confirmed local deletion; clear if selected; no upstream revoke.  |
| `move-existing "Native"`        | TUI-confirmed native OAuth move from `auth.json`, no copy/activation. |

References accept labels or UUIDs. Single words/UUIDs may be unquoted; spaced labels use JSON
double quotes and JSON escaping. Labels have 1–64 Unicode characters, no control/format characters,
and must be unique under NFKC normalization plus locale-independent lowercase folding. Completion
accepts quoted/unquoted label prefixes and UUIDs. Adding, reauthenticating, renaming and moving do
not implicitly select. Failed validation leaves the prior selection intact.

Management requires idle Pi and no managed-provider authorization/request. Login stays busy through
completion/cancellation, and shutdown aborts it. Login/removal/native moves need interactive TUI,
not RPC/print. RPC clients can explicitly use an existing account, inspect status/list, rename or
clear. No custom login/destructive confirmation is attempted there.

`--openai-account "Work Team"` (or UUID) explicitly overrides saved selection without rewriting it.
An invalid explicit override remains unavailable, never falling back to saved/native identity.
Selection entries are `{version: 1, accountId: string | null}` with custom type
`openai-multi-account`. Restore takes the latest matching entry in **physical session-file order**,
not a previous branch's identity. Restore checks local credential validity, not network access.
Expired credentials may refresh on explicit use or request. List/status do not refresh. The footer
appears only for managed-provider models and offers an actionable command if unselected.

A credential's local shape does not prove subscription entitlement, quota or online validity.
Native OAuth endpoints/account access can change; there are no automated live account tests.

## Authorization and request safety

[bridge.ts](../bridge.ts) exposes the native model catalog under `openai-multi`, authorizes a
captured account through an isolated native provider runtime, and delegates streaming. It maps
assistant-provider identity for history/results without mutating caller history. Normal OpenAI
models/credentials stay separate. [credentials.ts](../credentials.ts) supplies vault-backed native
OAuth credentials and refresh persistence; no ambient native-auth fallback is used.

Each authorization resolution creates an independent, request-scoped **one-use 30-second lease**
covering host header preparation before streaming. A private ephemeral request header binds it to
the resolved native token. It is never persisted or sent to native transport/raw hooks. Consumed,
cancelled, unknown or expired leases fail closed even if the same account remains selected. Unused
expired leases are removed lazily on activity checks or later authorization. Streams remain guarded
for their **entire lifetime**, not only 30 seconds.

Preserve the defenses against credential/auth/host/account-header and endpoint/model overrides. The
managed provider validates canonical native model identity and strips its private lease header
before forwarding; callers cannot supply arbitrary auth/environment/fetch/base endpoint overrides.
Raw hooks use the managed model identity, not the private request marker. Failure messages use
generic context rather than raw native errors. Labels/UUIDs are metadata; tokens never belong in
command output. These controls do not make the plaintext vault encrypted or safe to share.

## OAuth lifecycle

[oauth.ts](../oauth.ts) uses Pi's public native OpenAI OAuth helper and `LoginDialogComponent`
inside `ui.custom`; it is not a replacement login flow. The effective settings device UUID is used
when available, otherwise the vault UUID. Escape/session shutdown cancels login without saving
credentials. Failed/cancelled reauthentication preserves the existing credential/selection. Prompt
abort, dialog abort and native completion must settle once and detach cancellation listeners. The
[OAuth lifecycle fixtures](../tests/oauth.test.ts) inject native login/dialog fakes; production
continues to use the native components. Generic interaction infrastructure is described in the
[shared TUI guide](../../docs/tui.md), not a new OAuth API.

## Vault and native migration

Vault: `getAgentDir()/openai-multi/accounts.json`. It contains **plaintext secrets**. Protect agent
directory permissions, backups and filesystem access; never share it or native OAuth-flow logs.
[vault.ts](../vault.ts) requires private owner permissions and rejects unsafe paths. Version-1
storage has a device UUID and accounts keyed by UUID, with labels, native OAuth credentials,
canonical ISO 8601 creation/update timestamps and optional pending-move journal. Do not replace
atomic writes/locking/ownership checks with uncoordinated file edits.

[migration.ts](../migration.ts) performs recoverable moves, not copies, from native `auth.json`.
Startup attempts pending-move recovery without creating/selecting an account. Startup and explicit
`move-existing` warn if recovery rolls back an interrupted move because native credentials changed.

**Close other Pi sessions before moving.** The move removes global normal OpenAI login for all
local sessions. Removing a managed account likewise affects every session using it. Back up private
auth files securely; do not manually edit either credential file during migration. Local removal
does not revoke upstream authorization. Normal OpenAI auth is not a fallback if a managed account
is unavailable.

## Execution paths and troubleshooting

[index.ts](../index.ts) owns command parsing/completion, idle guards, selection/session entries,
model-registry refresh, status and login cancellation. [bridge.ts](../bridge.ts) owns provider
registration behavior, authorization leases and stream delegation; credential persistence and
migration remain in the modules above. Domain actions and native OAuth/credential safety do not
move into the generic TUI framework.

- Unselected/unavailable: inspect local `list`/`status`, explicitly `use` a label/UUID and select
  an `openai-multi` model. Inspect launch flags if valid saved selection seems ignored. Do not rely
  on native fallback or treat local expiry as online verification.
- Management refused: wait for login/authorization/stream completion or cancel it; do not bypass
  request guards or manually edit credentials.
- Unsafe path/permission error: inspect private ownership/path safety without printing secrets or
  loosening privacy checks. Do not paste vault contents into reports.
- Interrupted native move: read the rollback warning, keep other sessions closed and retry with a
  new label when instructed. Do not merge credential files manually.
- RPC login/removal unavailable: expected; use the interactive TUI for these operations rather than
  inventing a remote dialog or exposing authorization codes.

## Verification

With existing root tooling, run `npm run typecheck`, `npm test` and `npm run format:check` from
this package; see [workspace development](../../docs/development.md). Format docs with pinned
99-column Markdown dprint settings and an explicit file scope for reference files if absent from
the package's configured includes. Coordinate shared builds/generated files and format only owned
paths during parallel work.

Command tests use fake Pi contexts and in-memory vault operations, not real authentication. OAuth
fixtures cover cancellation, prompt abort and one-time completion without network.
Storage/migration and provider/stream tests exercise private-path checks, recovery, identity
normalization, override rejection and request leases. Installed integration fixtures check host
registration. None verifies live account entitlement or quota.

### Manual real-account checklist (explicit opt-in)

Use authorized accounts only; these steps can contact OAuth endpoints and send real requests. Never
expose credential contents in reports.

1. Back up private auth files securely. Use a disposable session, select a managed model and check
   the actionable unselected footer.
2. Add two differently labeled accounts. Neither should be selected implicitly, and native OpenAI
   credentials should remain untouched.
3. Cancel each login prompt/browser-device authorization stage and test shutdown during login.
   Confirm no partial account and management becomes available again.
4. Explicitly use each account and send a harmless prompt. Verify selected identity, expired-token
   refresh and failed refresh without fallback.
5. Restart/switch sessions and navigate/fork branches. Check latest physical selection/clear
   restoration, valid label/UUID flags, and invalid flag over an otherwise valid saved selection.
6. Rename/reauthenticate the selected account, retaining UUID. Check case-folded duplicates and the
   64-character label limit.
7. Attempt management during streaming/refresh and check refusal. Switch to a non-managed model and
   confirm footer removal.
8. In RPC, test list/status/use/clear; add/reauth/remove/move-existing must not open dialogs or
   modify credentials.
9. In a backed-up test environment, confirm native move preserves unrelated auth entries, does not
   activate, and safely recovers interruption. Keep other sessions closed.
10. Confirm removal of a selected account restores explicit clear; cancelled removal leaves it
    usable. Remember deletion does not revoke the upstream login.
