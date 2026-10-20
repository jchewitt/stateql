import { buildSchema, GraphQLError } from 'graphql';
import {
  BillingFixture,
  tenant,
  type Invoice,
  type InvoiceStatus,
  type TenantId,
} from './fixture.js';

export const schemaSource = `
  enum InvoiceStatus { OPEN PAID }
  type User { id: ID!, tenantId: ID!, name: String! }
  type Invoice {
    id: ID!
    tenantId: ID!
    accountId: String
    amountCents: Int!
    status: InvoiceStatus!
    user: User!
  }
  type Billing {
    tenantId: ID!
    invoices(status: InvoiceStatus): [Invoice!]!
  }
  type Query { billing(tenantId: ID!): Billing! }
  type Mutation { saveInvoice(tenantId: ID!, id: ID!, accountId: String): Invoice! }
`;

export const schema = buildSchema(schemaSource);

export function createRoot(
  fixture: BillingFixture,
  snapshot: Record<TenantId, Invoice[]>,
  failAccountId: boolean,
) {
  return {
    billing: ({ tenantId }: { tenantId: string }) => {
      const scope = tenant(tenantId);
      return {
        tenantId: scope,
        invoices: ({ status }: { status?: InvoiceStatus | null }) =>
          snapshot[scope]
            .filter((invoice) => status == null || invoice.status === status)
            .map((invoice) => ({
              ...invoice,
              accountId: () => {
                if (failAccountId)
                  throw new GraphQLError('Injected accountId failure', {
                    extensions: { code: 'FIXTURE_FIELD_FAILURE' },
                  });
                return invoice.accountId;
              },
            })),
      };
    },
    saveInvoice: ({
      tenantId,
      id,
      accountId,
    }: {
      tenantId: string;
      id: string;
      accountId?: string | null;
    }) => {
      if (accountId === undefined)
        throw new Error(
          'Provide accountId, including explicit null when clearing it.',
        );
      try {
        return fixture.save(tenant(tenantId), id, accountId);
      } catch (error) {
        throw new GraphQLError(
          error instanceof Error ? error.message : 'Save rejected.',
          { extensions: { code: 'FIXTURE_SAVE_REJECTED' } },
        );
      }
    },
  };
}
