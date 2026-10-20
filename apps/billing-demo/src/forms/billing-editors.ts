import { Component, input } from '@angular/core';
import type { TenantId } from '../data/operations';
import { InvoiceEditor } from './invoice-editor';

@Component({
  selector: 'billing-editors',
  imports: [InvoiceEditor],
  template: `<section aria-label="Form comparison">
    <h2>Two editors. Separate drafts.</h2>
    <p class="muted">
      Typing stays local. Save sends one command, then refreshes the account
      field. Server conflicts require an explicit choice.
    </p>
    <div class="consumers">
      <invoice-editor
        [tenantId]="tenantId()"
        title="Editor one"
      /><invoice-editor [tenantId]="tenantId()" title="Editor two" />
    </div>
  </section>`,
})
export class BillingEditors {
  readonly tenantId = input.required<TenantId>();
}
