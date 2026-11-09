# OpenAI Multi

An explicit, per-session ChatGPT OAuth account selector for Pi. Models are exposed under the
**openai-multi** provider; normal OpenAI models and native credentials remain separate. There is no
rotation, quota detection, automatic retry with another identity, API-key import, or implicit
account activation.

## Commands

Use `/openai-accounts` in the TUI for an account-management picker, including **Add account**.
Picking an account opens management actions; it does not silently activate it.

| Command                                          | Effect                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `/openai-accounts add "Work Team"`               | Native interactive ChatGPT OAuth login; save without selecting.                                       |
| `/openai-accounts list`                          | Local labels and stable UUIDs; selected account marked `*`. No network refresh.                       |
| `/openai-accounts status`                        | Report local selection, without refreshing credentials.                                               |
| `/openai-accounts use "Work Team"`               | Validate native OAuth authorization, then persist selection. Refresh may require network.             |
| `/openai-accounts clear`                         | Persist an explicitly empty selection.                                                                |
| `/openai-accounts rename "Work Team" "Personal"` | Change label, preserving UUID and selection.                                                          |
| `/openai-accounts reauth "Personal"`             | Replace that account's credential via native login, preserving UUID and selection.                    |
| `/openai-accounts remove "Personal"`             | TUI-confirmed local deletion; clear selection if selected. Does not revoke the upstream login.        |
| `/openai-accounts move-existing "Native"`        | TUI-confirmed move of the native OpenAI OAuth credential from `auth.json`; no copy and no activation. |

References accept a label or UUID. Single-word labels and UUIDs may be unquoted. Use JSON double
quotes for labels containing spaces, with JSON escaping when necessary. Labels contain 1–64 Unicode
characters, no control/format characters, and are unique under the vault's normalized case-folding
rules. Completion accepts quoted or unquoted label prefixes and UUIDs.

Launch Pi with `--openai-account "Work Team"` (or a UUID) to override saved session selection. An
invalid explicit override remains unavailable: it does not fall back to a saved or native account.
This flag does not rewrite the saved selection. Selection entries have `{version: 1, accountId:
string | null}`; restoration takes the latest matching entry in physical session-file order, rather
than choosing a previous branch's identity. Restore checks local credential validity, not network
access. Expired credentials may refresh on explicit use or a request.

## Safety and limitations

Management requires an idle Pi session and no active managed-provider authorization/request. Each
authorization resolution creates an independent, request-scoped one-use lease, bounded to 30
seconds, covering host header preparation before streaming. A private ephemeral request header
binds that lease to the resolved native token; it is never persisted or sent to native transport or
raw hooks. Consumed, cancelled, unknown, and expired leases fail closed, even if the same account
remains selected. Unused expired leases are removed lazily on activity checks or subsequent
authorization. Actual streams remain guarded for their entire lifetime, not just 30 seconds. Login
is busy until completion or cancellation; shutdown aborts login. Login, removal, and
native-credential moves require the interactive **TUI**, not RPC or print mode. RPC clients can
explicitly use an existing account, inspect status/list, rename, or clear; no custom login dialog
or destructive confirmation is attempted there. Failures use generic contextual messages rather
than raw native errors. Account labels and UUIDs are metadata; tokens are never included in command
output.

A footer is shown only for a managed-provider model. Missing selection includes an actionable
command. Adding, reauthenticating, renaming, and moving never implicitly select an account. Failed
validation leaves the prior selection intact. OAuth dialogs use Pi's native LoginDialogComponent
and native OpenAI provider; the effective settings device UUID is used when available, otherwise
the vault device UUID. Escape or session shutdown cancels login without saving a credential; a
failed or cancelled reauthentication leaves the existing credential and selection intact.

The private vault is stored in `getAgentDir()/openai-multi/accounts.json`. It contains **plaintext
secrets**, not encrypted credentials: protect the agent directory, backups, and filesystem access.
Storage requires private owner permissions and rejects unsafe paths. The schema is versioned and
keyed by account UUID, including ISO 8601 string creation/update timestamps and an optional
pending-move journal. Native credential moves are recoverable; startup attempts pending-move
recovery without creating a new account or selecting one. Startup and explicit `move-existing` both
warn if recovery rolls back an interrupted move because native credentials changed. Close other Pi
sessions before moving: the move removes the global normal OpenAI login for all local sessions.
Removing a managed account likewise affects every local session using it. Do not manually edit
either credential file during migration. Do not share the vault or logs from native OAuth flows.
Normal OpenAI auth is not used as a fallback.

This package does not prove subscription entitlement or available quota during metadata inspection.
No live account tests are automated. Native OAuth endpoints and account access can change; a local
credential's shape alone does not establish server-side validity.

## Development verification

From this directory run `npm run typecheck`, `npm test`, and `npm run format:check` using the
repository's existing installed tooling. Command tests use a fake Pi context and in-memory vault
operations; they do not authenticate real users. OAuth lifecycle tests inject a fake native login
helper and dialog to cover cancellation, prompt abort, and one-time completion without network
access; production continues to use Pi's public native OAuth helper and dialog.

### Manual real-account checklist (opt-in)

1. Back up private auth files securely. Start in a disposable session; select a managed model and
   verify the actionable unselected footer.
2. Add two differently labeled real accounts. Verify neither is implicitly selected and native
   OpenAI credentials are untouched.
3. Cancel login at each prompt and during browser/device authorization; verify no partial account
   and that management becomes available again. Test shutdown during login.
4. Explicitly use each account and send a harmless prompt. Check that only the selected identity is
   used; test expired-token refresh and failed refresh without fallback.
5. Restart, switch sessions, and navigate/fork branches; confirm latest physical selection/clear
   restoration. Test valid label/UUID flags and an invalid flag over an otherwise valid saved
   selection.
6. Rename and reauthenticate the selected account; check stable UUID. Test duplicate case-folded
   labels and the 64-character limit.
7. During streaming and OAuth refresh, attempt management and confirm refusal. Switch to a
   non-managed model and check footer removal.
8. In RPC, test list/status/use/clear and verify add/reauth/remove/move-existing do not open
   dialogs or modify credentials.
9. In a backed-up test environment, confirm a native move preserves unrelated auth entries, does
   not activate, and safely recovers interrupted migration. Never expose credential contents in
   reports.
10. Remove a selected account with confirmation and verify explicit clear restoration; cancellation
    must leave it usable.
