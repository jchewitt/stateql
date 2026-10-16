import { listen } from './server.js';

const port = Number(process.env['BILLING_API_PORT'] ?? 4100);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid BILLING_API_PORT.');
const api = await listen(port);
console.log(`Billing fixture: ${api.url}/graphql (local development only)`);
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, () => {
    void api.close();
  });
