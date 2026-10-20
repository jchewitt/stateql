import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { format } from 'prettier';
import { generateSchemaModule } from '../packages/graphql/dist/codegen.js';
import { schemaSource } from '../apps/billing-api/src/schema.js';

const destinations = [
  '../examples/query-planner/src/generated/billing.ts',
  '../apps/billing-demo/src/data/generated/billing.ts',
].map((path) => new URL(path, import.meta.url));
const output = await format(
  generateSchemaModule(schemaSource, {
    identities: {
      Billing: ['tenantId'],
      Invoice: ['tenantId', 'id'],
      User: ['tenantId', 'id'],
    },
  }),
  { parser: 'typescript', singleQuote: true },
);
for (const destination of destinations) {
  if (process.argv.includes('--check')) {
    if ((await readFile(destination, 'utf8')) !== output)
      throw new Error(
        'Generated billing schema is stale. Run pnpm generate:billing.',
      );
  } else {
    await mkdir(new URL('.', destination), { recursive: true });
    await writeFile(destination, output);
  }
}
