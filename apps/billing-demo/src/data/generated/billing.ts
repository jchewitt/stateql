// Generated from the GraphQL schema. Do not edit.
import {
  createSchema,
  type FieldType,
  type ObjectRef,
} from '@jchewitt/stateql-graphql';
export type GeneratedTypes = {
  Billing: {
    readonly tenantId: FieldType<string, {}>;
    readonly invoices: FieldType<
      readonly ObjectRef<'Invoice'>[],
      { readonly status?: 'OPEN' | 'PAID' | null }
    >;
  };
  Invoice: {
    readonly id: FieldType<string, {}>;
    readonly tenantId: FieldType<string, {}>;
    readonly accountId: FieldType<string | null, {}>;
    readonly amountCents: FieldType<number, {}>;
    readonly status: FieldType<'OPEN' | 'PAID', {}>;
    readonly user: FieldType<ObjectRef<'User'>, {}>;
  };
  Mutation: {
    readonly saveInvoice: FieldType<
      ObjectRef<'Invoice'>,
      {
        readonly tenantId: string;
        readonly id: string;
        readonly accountId?: string | null;
      }
    >;
  };
  Query: {
    readonly billing: FieldType<
      ObjectRef<'Billing'>,
      { readonly tenantId: string }
    >;
  };
  User: {
    readonly id: FieldType<string, {}>;
    readonly tenantId: FieldType<string, {}>;
    readonly name: FieldType<string, {}>;
  };
};
export const schema = createSchema<GeneratedTypes>(
  'enum InvoiceStatus {\n  OPEN\n  PAID\n}\n\ntype User {\n  id: ID!\n  tenantId: ID!\n  name: String!\n}\n\ntype Invoice {\n  id: ID!\n  tenantId: ID!\n  accountId: String\n  amountCents: Int!\n  status: InvoiceStatus!\n  user: User!\n}\n\ntype Billing {\n  tenantId: ID!\n  invoices(status: InvoiceStatus): [Invoice!]!\n}\n\ntype Query {\n  billing(tenantId: ID!): Billing!\n}\n\ntype Mutation {\n  saveInvoice(tenantId: ID!, id: ID!, accountId: String): Invoice!\n}',
  {
    identities: {
      Billing: ['tenantId'],
      Invoice: ['tenantId', 'id'],
      User: ['tenantId', 'id'],
    },
  },
);
