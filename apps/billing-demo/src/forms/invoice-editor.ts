import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FixtureService } from '../fixture.service';
import type { TenantId } from '../data/operations';
import {
  DraftSession,
  validAccount,
  type DraftState,
  type EditorBinding,
  type EditorTarget,
} from './draft';
import { EDITOR_SOURCE } from './sources';

@Component({
  selector: 'invoice-editor',
  imports: [ReactiveFormsModule],
  templateUrl: './invoice-editor.html',
})
export class InvoiceEditor {
  readonly tenantId = input.required<TenantId>();
  readonly title = input.required<string>();
  readonly recordId = signal('INV-1');
  readonly control = new FormControl<string | null>('', {
    validators: (control) =>
      validAccount(control.value) ? null : { accountId: true },
  });
  readonly state = signal<DraftState | undefined>(undefined);
  private readonly bound = signal<EditorTarget | undefined>(undefined);
  readonly ready = computed(
    () =>
      this.bound()?.tenantId === this.tenantId() &&
      this.bound()?.id === this.recordId(),
  );
  private readonly source = inject(EDITOR_SOURCE);
  private readonly fixture = inject(FixtureService);
  private session: DraftSession | undefined;
  private binding: EditorBinding | undefined;

  constructor() {
    const edits = this.control.valueChanges.subscribe((value) => {
      if (this.ready()) this.session?.edit(value);
    });
    inject(DestroyRef).onDestroy(() => edits.unsubscribe());
    effect((cleanup) => {
      const target: EditorTarget = Object.freeze({
        tenantId: this.tenantId(),
        id: this.recordId(),
      });
      untracked(() => {
        const session = new DraftSession((state) => {
          this.state.set(state);
          if (this.control.value !== state.draft)
            this.control.setValue(state.draft ?? null, { emitEvent: false });
          if (!state.dirty) this.control.markAsPristine();
        });
        const binding = this.source.open(target);
        this.session = session;
        this.binding = binding;
        this.bound.set(target);
        const stop = binding.subscribe(() => session.observe(binding.read()));
        session.observe(binding.read());
        cleanup(() => {
          session.dispose();
          stop();
          binding.dispose();
          this.session = undefined;
          this.binding = undefined;
        });
      });
    });
  }
  selectRecord(event: Event): void {
    this.recordId.set((event.target as HTMLSelectElement).value);
  }
  save(): void {
    const target = this.bound();
    if (!this.ready() || !target || !this.session || !this.binding) return;
    void this.session
      .save(target, this.source, this.binding)
      .finally(() => this.fixture.inspect());
  }
  refresh(): void {
    if (!this.ready() || !this.session || !this.binding) return;
    void this.session
      .refresh(this.binding)
      .finally(() => this.fixture.inspect());
  }
  resolve(useServer: boolean): void {
    if (this.ready()) this.session?.resolve(useServer);
  }
  text(value: string | null | undefined): string {
    return value === undefined
      ? 'Unavailable'
      : value === null
        ? '(null)'
        : value;
  }
}
