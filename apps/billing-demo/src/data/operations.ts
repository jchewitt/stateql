import { gql, type TypedDocumentNode } from '@apollo/client/core';

export type TenantId = 'A' | 'B';
export interface BillingVariables {
  tenantId: TenantId;
}
export interface Invoice {
  readonly __typename: 'Invoice';
  readonly id: string;
  readonly tenantId: TenantId;
  readonly accountId: string | null;
  readonly amountCents: number;
  readonly status: 'OPEN' | 'PAID';
  readonly user: {
    readonly __typename: 'User';
    readonly id: string;
    readonly tenantId: TenantId;
    readonly name: string;
  };
}
export interface BillingResult {
  readonly billing: {
    readonly __typename: 'Billing';
    readonly tenantId: TenantId;
    readonly invoices: readonly Invoice[];
  };
}
type AccountInvoice = Pick<
  Invoice,
  '__typename' | 'id' | 'tenantId' | 'accountId'
>;
export interface AccountResult {
  readonly billing: {
    readonly __typename: 'Billing';
    readonly tenantId: TenantId;
    readonly invoices: readonly AccountInvoice[];
  };
}

export const INVOICE_IDENTITY = gql`
  fragment InvoiceIdentity on Invoice {
    id
    tenantId
  }
`;
export const INVOICE_DETAILS = gql`
  fragment InvoiceDetails on Invoice {
    ...InvoiceIdentity
    accountId
    amountCents
    status
    user {
      id
      tenantId
      name
    }
  }
  ${INVOICE_IDENTITY}
`;
export const BILLING_INVOICES: TypedDocumentNode<
  BillingResult,
  BillingVariables
> = gql`
  query BillingInvoices($tenantId: ID!) {
    billing(tenantId: $tenantId) {
      tenantId
      invoices {
        ...InvoiceDetails
      }
    }
  }
  ${INVOICE_DETAILS}
`;
export const INVOICE_ACCOUNTS: TypedDocumentNode<
  AccountResult,
  BillingVariables
> = gql`
  query InvoiceAccounts($tenantId: ID!) {
    billing(tenantId: $tenantId) {
      tenantId
      invoices {
        ...InvoiceIdentity
        accountId
      }
    }
  }
  ${INVOICE_IDENTITY}
`;
export const SAVE_INVOICE: TypedDocumentNode<
  { readonly saveInvoice: Pick<Invoice, '__typename' | 'id' | 'tenantId'> },
  BillingVariables & { id: string; accountId: string | null }
> = gql`
  mutation SaveInvoice($tenantId: ID!, $id: ID!, $accountId: String) {
    saveInvoice(tenantId: $tenantId, id: $id, accountId: $accountId) {
      ...InvoiceIdentity
    }
  }
  ${INVOICE_IDENTITY}
`;
