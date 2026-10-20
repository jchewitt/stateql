import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { execute, getOperationAST, parse, validate, visit } from 'graphql';
import { BillingFixture, tenant, type FixtureSettings } from './fixture.js';
import { createRoot, schema } from './schema.js';

export interface RequestRecord {
  id: number;
  operationName: string;
  query: string;
  variables: Record<string, unknown>;
  fields: string[];
  responseBytes: number;
  errors: string[];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new HttpError(415, 'Use application/json.');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new HttpError(413, 'Request too large.');
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}

function send(
  response: ServerResponse,
  status: number,
  value: unknown,
): number {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
  return Buffer.byteLength(body);
}

/** Local test fixture only. Destructive controls are deliberately not a production API. */
export function createBillingServer(fixture = new BillingFixture()) {
  let records: RequestRecord[] = [];
  let count = 0;
  let epoch = 0;
  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent)
        send(response, error instanceof HttpError ? error.status : 400, {
          error: error instanceof Error ? error.message : 'Invalid request.',
        });
      else response.end();
    });
  });

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const path = request.url?.split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      send(response, 200, { ok: true });
      return;
    }
    if (request.method === 'GET' && path === '/__fixture/requests') {
      send(response, 200, { count, records });
      return;
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST.');
    const body = await readJson(request);
    // JSON-only POSTs and no CORS keep browser fixture controls same-origin.
    if (path === '/__fixture/control') {
      switch (body['action']) {
        case 'reset':
          fixture.reset();
          records = [];
          count = 0;
          epoch++;
          break;
        case 'advance':
          fixture.advance(tenant(body['tenantId']));
          break;
        case 'reverse':
          fixture.reverse(tenant(body['tenantId']));
          break;
        case 'remove':
          if (typeof body['id'] !== 'string')
            throw new HttpError(400, 'id must be a string.');
          fixture.remove(tenant(body['tenantId']), body['id']);
          break;
        case 'configure':
          fixture.configure({
            latencyMs: body['latencyMs'],
            failNext: body['failNext'],
          } as FixtureSettings);
          break;
        default:
          throw new HttpError(400, 'Unknown fixture action.');
      }
      send(response, 200, { ok: true });
      return;
    }
    if (path !== '/graphql') throw new HttpError(404, 'Unknown route.');
    if (typeof body['query'] !== 'string')
      throw new HttpError(400, 'query must be a string.');
    const variables = body['variables'] ?? {};
    if (typeof variables !== 'object' || Array.isArray(variables))
      throw new HttpError(400, 'variables must be an object.');
    const operationName = body['operationName'];
    if (
      operationName !== undefined &&
      operationName !== null &&
      typeof operationName !== 'string'
    )
      throw new HttpError(400, 'Invalid operationName.');
    const document = parse(body['query']);
    const errors = validate(schema, document);
    if (errors.length) {
      send(response, 400, { errors });
      return;
    }
    const operation = getOperationAST(document, operationName);
    if (!operation) throw new HttpError(400, 'Choose one operation.');
    if (operation.operation === 'subscription')
      throw new HttpError(400, 'Subscriptions are not supported.');
    const settings = fixture.takeSettings();
    const snapshot = fixture.snapshot();
    const requestEpoch = epoch;
    const id = ++count;
    const fields = new Set<string>();
    visit(document, {
      Field(node) {
        fields.add(node.name.value);
      },
    });
    if (settings.latencyMs) await delay(settings.latencyMs);
    if (requestEpoch !== epoch)
      throw new HttpError(409, 'Fixture was reset during this request.');
    const result =
      settings.failNext === 'request'
        ? {
            errors: [
              {
                message: 'Injected request failure',
                extensions: { code: 'FIXTURE_REQUEST_FAILURE' },
              },
            ],
          }
        : await execute({
            schema,
            document,
            rootValue: createRoot(
              fixture,
              snapshot,
              settings.failNext === 'accountId',
            ),
            variableValues: variables as Record<string, unknown>,
            operationName,
          });
    const responseBytes = send(
      response,
      settings.failNext === 'request' ? 503 : 200,
      result,
    );
    records.push({
      id,
      operationName: operation.name?.value ?? '(anonymous)',
      query: body['query'],
      variables: variables as Record<string, unknown>,
      fields: [...fields],
      responseBytes,
      errors: result.errors?.map((error) => error.message) ?? [],
    });
    records = records.slice(-100);
  }

  return { server, fixture };
}

export async function listen(port = 4100) {
  const { server, fixture } = createBillingServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address.');
  return {
    server,
    fixture,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
