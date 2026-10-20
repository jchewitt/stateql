/** Demo editing policy, independent of Angular and either cache client. */
export type AccountValue = string | null;
export function validAccount(value: unknown): value is AccountValue {
  return (
    value === null ||
    (typeof value === 'string' && value.length > 0 && value.length <= 80)
  );
}
export type ServerField =
  | { readonly available: true; readonly value: AccountValue }
  | { readonly available: false; readonly reason: string };
export interface EditorTarget {
  readonly tenantId: 'A' | 'B';
  readonly id: string;
}
export interface EditorBinding {
  read(): ServerField;
  subscribe(notify: () => void): () => void;
  /** A read only: never resubmit a mutation. May outlive the visible editor. */
  refresh(): Promise<ServerField>;
  dispose(): void;
}
export interface EditorSource {
  open(target: EditorTarget): EditorBinding;
  save(target: EditorTarget, value: AccountValue): Promise<void>;
}
export class SaveError extends Error {
  constructor(
    message: string,
    readonly outcome: 'rejected' | 'unknown',
  ) {
    super(message);
  }
}
export type SavePhase =
  | 'idle'
  | 'saving'
  | 'refreshing'
  | 'saved'
  | 'rejected'
  | 'unknown'
  | 'saved-refresh-failed';
export interface DraftState {
  readonly draft: AccountValue | undefined;
  readonly baseline: AccountValue | undefined;
  readonly latest: AccountValue | undefined;
  readonly available: boolean;
  readonly unavailableReason: string;
  readonly phase: SavePhase;
  readonly message: string;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canResolve: boolean;
}

/** One instance per editor/target; no shared state, transport or cache ownership. */
export class DraftSession {
  private draft: AccountValue | undefined;
  private baseline: AccountValue | undefined;
  private latest: AccountValue | undefined;
  private available = false;
  private unavailableReason = 'Waiting for server data.';
  private phase: SavePhase = 'idle';
  private message = '';
  private editGeneration = 0;
  private submitted:
    { readonly value: AccountValue; readonly generation: number } | undefined;
  private stopped = false;
  private reading = false;
  private reconciliationReadRequired = false;
  constructor(private readonly notify: (state: DraftState) => void) {}

  get state(): DraftState {
    const dirty = this.draft !== this.baseline;
    const conflict =
      dirty && this.latest !== this.baseline && this.latest !== this.draft;
    const busy =
      this.reading || this.phase === 'saving' || this.phase === 'refreshing';
    const valid = validAccount(this.draft);
    return Object.freeze({
      draft: this.draft,
      baseline: this.baseline,
      latest: this.latest,
      available: this.available,
      unavailableReason: this.unavailableReason,
      phase: this.phase,
      message: this.message,
      dirty,
      conflict,
      busy,
      canSave:
        valid &&
        dirty &&
        this.available &&
        !conflict &&
        !busy &&
        this.phase !== 'unknown' &&
        this.phase !== 'saved-refresh-failed',
      canResolve:
        this.available &&
        !busy &&
        !this.submitted &&
        !this.reconciliationReadRequired,
    });
  }
  private emit(): void {
    if (!this.stopped) this.notify(this.state);
  }
  observe(field: ServerField): void {
    if (this.stopped) return;
    this.available = field.available;
    if (field.available) {
      this.latest = field.value;
      if (!this.state.dirty && !this.submitted && this.phase !== 'unknown') {
        this.baseline = field.value;
        this.draft = field.value;
      }
      this.unavailableReason = '';
    } else this.unavailableReason = field.reason;
    this.emit();
  }
  edit(value: AccountValue): void {
    if (this.stopped) return;
    this.draft = value;
    this.editGeneration++;
    if (!this.state.busy && !this.submitted && this.phase !== 'unknown') {
      this.phase = 'idle';
      this.message = '';
    }
    this.emit();
  }
  resolve(useServer: boolean): void {
    if (
      this.stopped ||
      !this.state.canResolve ||
      this.latest === undefined ||
      this.state.busy ||
      this.submitted
    )
      return;
    const uncertain = this.phase === 'unknown';
    this.baseline = this.latest;
    if (useServer) this.draft = this.latest;
    this.editGeneration++;
    this.phase = 'idle';
    this.message = uncertain
      ? 'Reconciled with current server data; the previous save acknowledgement remains unknown.'
      : '';
    this.emit();
  }
  async save(
    target: EditorTarget,
    source: EditorSource,
    binding: EditorBinding,
  ): Promise<void> {
    if (this.stopped || !this.state.canSave || this.draft === undefined) return;
    const commandTarget = Object.freeze({ ...target });
    const submitted = Object.freeze({
      value: this.draft,
      generation: this.editGeneration,
    });
    this.submitted = submitted;
    this.phase = 'saving';
    this.message = 'Saving…';
    this.emit();
    try {
      await source.save(commandTarget, submitted.value);
    } catch (error) {
      if (this.stopped) return;
      this.submitted = undefined;
      this.phase =
        error instanceof SaveError && error.outcome === 'rejected'
          ? 'rejected'
          : 'unknown';
      this.reconciliationReadRequired = this.phase === 'unknown';
      this.message =
        this.phase === 'unknown'
          ? 'Save acknowledgement unknown. Refresh and reconcile before another save.'
          : `Save rejected: ${error instanceof Error ? error.message : 'Request failed.'}`;
      if (this.phase === 'unknown') {
        this.available = false;
        this.unavailableReason =
          'Refresh server data before reconciling the uncertain save.';
      }
      this.emit();
      return;
    }
    // A confirmed command still refreshes its captured scope after editor disposal.
    if (!this.stopped) {
      this.phase = 'refreshing';
      this.message = 'Saved; refreshing server values…';
      this.emit();
    }
    await this.refresh(binding, true);
  }
  async refresh(binding: EditorBinding, afterSave = false): Promise<void> {
    if (!afterSave && (this.stopped || this.state.busy)) return;
    const submission = this.submitted;
    const confirmed = afterSave || this.phase === 'saved-refresh-failed';
    this.reading = true;
    this.emit();
    try {
      const field = await binding.refresh();
      if (!field.available) throw new Error(field.reason);
      if (this.stopped) return;
      this.reconciliationReadRequired = false;
      if (confirmed && submission) {
        this.baseline = field.value;
        if (this.editGeneration === submission.generation)
          this.draft = field.value;
        this.submitted = undefined;
        this.phase = 'saved';
        this.message = 'Saved and refreshed.';
      }
      this.observe(field);
    } catch (error) {
      if (this.stopped) return;
      this.available = false;
      this.unavailableReason =
        error instanceof Error ? error.message : 'Refresh failed.';
      if (confirmed) {
        this.phase = 'saved-refresh-failed';
        this.message = 'Saved; refresh failed. Retry refresh only.';
      } else if (this.phase !== 'unknown')
        this.message = `Refresh failed: ${this.unavailableReason}`;
    } finally {
      this.reading = false;
      this.emit();
    }
  }
  dispose(): void {
    this.stopped = true;
  }
}
