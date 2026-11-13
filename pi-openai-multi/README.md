# pi-openai-multi

Explicit per-session ChatGPT OAuth account selection for Pi. Models appear under **openai-multi**;
normal OpenAI models/native credentials remain separate. There is no rotation, quota detection,
automatic retry with another identity, API-key import or implicit account activation.

## Setup and first use

Requires Node >=22.19 and Pi host APIs; workspace development targets Pi 1.5.0. Install using
[repository instructions](../README.md), then `/reload` or restart Pi. Do not also register the
child package. After root installation, load only this extension from the bundle root with:

```sh
pi --no-extensions --extension ./pi-openai-multi/index.ts
```

OAuth login requires the interactive **TUI** and uses Pi's native ChatGPT/OpenAI login flow. Adding
an account saves it but does **not** select it. Explicitly select the account and an `openai-multi`
model before sending requests:

```text
/openai-accounts add "Work Team"
/openai-accounts list
/openai-accounts use "Work Team"
/model
/openai-accounts status
```

Choose an `openai-multi` model in `/model`. The footer appears only for that provider and shows the
selected label or an actionable unselected message. `list` and `status` inspect local metadata;
they do not refresh credentials or prove server-side access, subscription entitlement or quota.
Explicit `use` validates native OAuth authorization and may refresh over the network. Failed
validation leaves the previous selection intact; native OpenAI auth is never a fallback.

## Everyday commands

`/openai-accounts` opens the TUI management picker. Picking an account opens actions rather than
silently activating it. References accept labels or stable UUIDs; use JSON double quotes for labels
containing spaces.

| Command                         | Effect                                                    |
| ------------------------------- | --------------------------------------------------------- |
| `list` / `status`               | Inspect local accounts/selection without network refresh. |
| `use "Work Team"`               | Validate and persist an explicit session selection.       |
| `clear`                         | Persist an explicitly empty selection.                    |
| `rename "Work Team" "Personal"` | Change label, retaining UUID and selection.               |
| `reauth "Personal"`             | Native login replacing credentials, retaining identity.   |
| `remove "Personal"`             | TUI-confirmed local deletion; does not revoke upstream.   |
| `move-existing "Native"`        | TUI-confirmed **move**, not copy, of native OpenAI OAuth. |

Prefix each action with `/openai-accounts`. Adding, reauthenticating, renaming and moving never
implicitly select an account. Escape or shutdown cancels login without saving a partial credential;
failed/cancelled reauthentication preserves the existing credential/selection.

Launch with `pi --openai-account "Work Team"` (or UUID) for an explicit override that does not
rewrite saved selection. An invalid override stays unavailable; it does not fall back. Session
restoration uses the latest selection/clear in **physical session-file order**, not an earlier
branch's identity. See [selection and commands](docs/reference.md#selection-and-commands).

## Credential safety and limits

- The private vault at `getAgentDir()/openai-multi/accounts.json` holds **plaintext secrets**, not
  encrypted credentials. Protect the agent directory, backups and filesystem access. Never share
  the vault, credentials or logs from native OAuth flows.
- Close other Pi sessions before `move-existing`: it removes the global normal OpenAI login for
  **all local sessions**. Removing a managed account also affects other sessions using it. Back up
  private auth files securely; do not manually edit either credential file during migration.
- Management requires an idle session with no managed authorization/request in progress. Active
  streams remain guarded for their lifetime. Expired/cancelled/consumed authorization leases fail
  closed; there is no automatic identity fallback.
- Login, removal and native moves require TUI confirmation/dialogs, not RPC/print. RPC can use an
  existing account, inspect list/status, rename or clear. No replacement login/destructive dialog
  is attempted there.
- Metadata validity does not establish online access. Native endpoints/account access can change;
  real-account verification is an explicit opt-in, not an automated test guarantee.

## Reference and maintenance

[The reference](docs/reference.md) contains complete command/label rules, selection restoration,
request leases and override defenses, vault/migration contracts, OAuth lifecycle, troubleshooting,
offline checks and the opt-in real-account checklist.

See [workspace development](../docs/development.md) and [pi-kit infrastructure](../docs/pi-kit.md).
Account actions and OAuth/credential boundaries remain local; OAuth continues to use Pi's native
dialog and provider rather than a custom login implementation.
