import { buildSchema, execute } from 'graphql';

export const sdl = `
  type Query { billing(tenantId: ID!): Billing! }
  type Billing { tenantId: ID! invoices: [Invoice!]! }
  type Invoice { id: ID! accountId: String! amount: Int! user: User! }
  type User { id: ID! name(locale: String = "en"): String! }
`;
export const identities = {
  Billing: ['tenantId'],
  Invoice: ['id'],
  User: ['id'],
};

/** In-process GraphQL execution, used so the example needs no running server. */
export function createFixture() {
  const schema = buildSchema(sdl);
  let version = 1;
  /** @type {import('@jchewitt/stateql-graphql').PreparedOperation[]} */
  const requests = [];
  /** @type {import('@jchewitt/stateql-graphql').GraphQLTransport} */
  const transport = async (operation) => {
    requests.push(operation);
    return execute({
      schema,
      document: operation.document,
      variableValues: operation.variables,
      rootValue: {
        /** @param {{ tenantId: string }} args */
        billing: ({ tenantId }) => ({
          tenantId,
          invoices: [
            {
              id: 'invoice-1',
              accountId: `${tenantId}-account-v${version}`,
              amount: version * 10,
              user: {
                id: 'user-1',
                /** @param {{ locale: string }} args */
                name: ({ locale }) => `${locale}-user-v${version}`,
              },
            },
          ],
        }),
      },
    });
  };
  return {
    transport,
    requests,
    advance: () => {
      version++;
    },
  };
}
