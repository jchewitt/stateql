# Form drafts, server state, and explicit saves

P4.4 implements this contract in the billing demo, with the same local draft policy and Angular reactive-form editor for Apollo and StateQL. P4.5 browser scenarios exercise the policy with real HTTP fixtures; E1–E4 later add production streams, authoritative revisions, and durable commands.

## Separate ownership

Shared StateQL state contains the latest accepted server data plus freshness/error metadata. Each form owns its editable draft, validation, touched/dirty state, and save status. In Angular, reactive form controls already hold these local values: a second global cache is unnecessary for the proof of concept.

Typing does not commit to StateQL, update another editor, or send a network command. Observation runs from shared snapshots into the form binding; it does not implicitly run from control changes into the server cache. Programmatic form updates must suppress edit/write feedback where relevant. A later autosave policy can explicitly schedule commands; it must not be inferred from the presence of a WebSocket connection.

Draft identity includes client/session scope, resource/arguments, record identity, and an editor instance. Two forms editing one invoice can have different drafts while observing the same server state. A feature may deliberately share a draft within its own workflow, but that is a separate ownership choice. Destroying one form releases its binding; it does not dispose another consumer's cache or client. Draft persistence and an offline command outbox remain separate opt-in features.

## Reconcile base, draft, and latest server values

For each editable field, retain the server baseline from which the local edit started, the current draft, and the latest accepted server value. Use value comparison and an edit generation where necessary; Angular's dirty flag alone does not establish whether values diverged or whether edits occurred during a save. Missing values, explicit null, field errors, and incomplete snapshots must remain distinct.

| Situation                                                                   | Implemented demo behavior                                                                                                                                            |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untouched field receives a valid server value                               | Update its baseline and form value without creating a user edit or write command.                                                                                    |
| Dirty field receives the same server baseline                               | Keep the draft; there is no new competing server value.                                                                                                              |
| Dirty field receives a different server value and it differs from the draft | Keep the draft, display the latest server value and a conflict indication. Require a deliberate resolution before a conflicting save.                                |
| Server value equals the draft                                               | Show convergence, without treating a matching value as proof that a pending command was acknowledged.                                                                |
| Snapshot is stale, incomplete, or carries a field error                     | Preserve the draft and surface availability/error state; do not replace a control with a fabricated empty value.                                                     |
| User chooses “use server” or resets the form                                | Adopt the latest valid server value, not the possibly obsolete value from when the form opened.                                                                      |
| User deliberately keeps a conflicting edit                                  | Rebase after explicit resolution and revalidate; server concurrency preconditions are still needed to prevent a later race.                                          |
| Record disappears or becomes structurally unavailable                       | Preserve the draft for user review, mark its target unavailable, and block an ordinary save against a different or missing identity.                                 |
| Account, scope, or record changes                                           | The application decides discard/retain/prompt policy. Bind the new target separately; never silently carry old draft values or command outcomes across the boundary. |

Related fields can have business constraints. Revalidate affected controls/groups after a server merge; field-wise merging does not guarantee a valid business transaction or a consistent server snapshot. Structural changes and list rows use stable identity, never array position.

## Save is a command

The default proof-of-concept interaction is an explicit Save button. Capture an immutable submitted payload, its target identity/scope, and the submitted edit generations. Keep that submitted payload separate from the still-editable form. One outstanding command per editor is the initial policy; additional clicks must not duplicate it.

The command transport may eventually be HTTP or WebSockets. Sending on a socket is not an acknowledgement, and observing an arbitrary matching push is not proof that this command succeeded. Future command protocols need operation correlation, server revision/precondition rules, and idempotency before claiming safe replay.

On confirmed success, reconcile only the submitted edits that have not been superseded by subsequent typing. A user who submits “B” and then types “C” while the save is pending must still see “C” as an unsaved draft after “B” succeeds. Other app consumers see accepted server data, never “C” merely because it is in an editor. Server canonicalization can differ from the submitted value; use the authoritative response or an explicit refresh to establish the new baseline.

The proof of concept uses the existing mutation followed by targeted invalidation. Successful mutation and failed follow-up refresh are separate states: show “saved; refresh failed” and retain enough baseline/dirty information for recovery. Do not misreport a successful command as failed or automatically resend it. If the mutation response lacks authoritative field values, wait for valid refreshed values before claiming a confirmed baseline. A save failure preserves the draft and exposes its errors. An ambiguous acknowledgement remains unknown until reconciled; writes are not automatically retried.

Responses and push echoes must be correlated with the captured scope/record and save attempt. An old save must not clear dirty state in a replacement form or switch the visible account back. Future comparable server revisions will also prevent a late acknowledgement from overwriting newer accepted server data; local request generations alone do not solve that.

## Comparison and implementation boundary

The implementation lives in `apps/billing-demo/src/forms`: `DraftSession` holds one editor's baseline/draft/latest and command state; `InvoiceEditor` binds it to an Angular `FormControl`; `sources.ts` supplies Apollo/StateQL reads and targeted refreshes. `save-account.ts` is the same explicit HTTP mutation transport for both modes, returning only a validated identity acknowledgement. It has no retry or optimistic cache write. This is application coordination code and will be counted in P5, not a published forms package.

Each mode renders two editors. Both start on INV-1; each can select INV-2 independently. Tenant or record changes discard that editor's draft and create a new session. Missing records leave the current editor mounted with its draft preserved and Save blocked. **Use server value** resets to the latest valid value; **Keep my draft** explicitly rebases a conflict. Empty input is invalid; **Set null** intentionally submits GraphQL null.

Confirmed saves refresh their captured scope even after the editor leaves. StateQL uses a separate temporary narrow handle for each explicit refresh and disposes it in `finally`; Apollo's one-shot query owns its read until settlement. A successful refresh supplies the accepted baseline, including server canonicalization or a value changed by another writer. Edits made since submission remain dirty against that baseline; this is not a server revision/precondition guarantee.

The only definite rejection codes belong to this fixture's known pre-write failures. Lost connections, malformed/mismatched acknowledgements, and generic server errors leave the outcome unknown. Cached observations cannot unlock another save: a successful explicit refresh is required, followed by the user's deliberate resolution. That reconciliation does not retrospectively prove the earlier command's acknowledgement. A confirmed save with a failed refresh instead retains its submitted edit generation and exposes **Retry refresh**, which never sends another mutation.

StateQL supplies field freshness/errors and membership uncertainty. Apollo's demo binding uses watch-result loading/errors and explicit refresh results; Apollo does not provide the same per-field freshness metadata. These differences are not hidden behind a second cache. Both block ordinary saves when their binding reports the target unavailable.

P4.4 implements a small explicit demo binding around Angular reactive forms, using the same editing policy for Apollo and StateQL. It should contain no fetching, retry, cache identity, or transport engine. Share reusable draft-policy code when the two demos need identical behavior, and count this application code honestly in P5. Decide whether a library-level forms helper is warranted after the behavior is exercised.

P4.4/P4.5 cover isolated drafts in two editors, pristine updates, dirty conflicts, reset to latest server data, edits during save, rejected saves, confirmed-save/failed-refresh recovery, target switching, unavailable records, and cleanup. Deterministic HTTP fixtures can exercise these cases before real sockets exist; future E1/E2 tests must repeat them with pushed data and command acknowledgements.

The fixture currently provides no authoritative compare-and-swap revision contract. UI conflict detection cannot prevent a server write race by itself. Full revision-aware command conflicts belong to E2/E4; no form integration should claim otherwise.
