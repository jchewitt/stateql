import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  createProviderToken,
  provide,
  createProviderScope,
  createAcquisitionSourceToken,
  AcquisitionClient,
} from '../dist/index.js';

const token = (name = 'connection') =>
  createProviderToken(
    name,
    (value) =>
      !!value && typeof value === 'object' && typeof value.read === 'function',
  );
const connection = () => ({ read: () => 'value' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test('a retained initialization context does not retain its disposed owned resource', () => {
  execFileSync(process.execPath, [
    '--expose-gc',
    '--input-type=module',
    '-e',
    `
    import assert from 'node:assert/strict';
    import { createProviderToken, provide, createProviderScope } from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};
    let context, weak;
    async function exercise() {
      const token = createProviderToken('connection', value => !!value && typeof value.read === 'function');
      const scope = createProviderScope([provide(token, {
        ownership: 'owned', dispose() {},
        useFactory(input) {
          context = input;
          const value = { read() {}, payload: new Array(10000).fill(1) };
          weak = new WeakRef(value);
          return value;
        },
      })]);
      await scope.resolve(token);
      await scope.dispose();
    }
    await exercise();
    for (let i = 0; i < 10; i++) { await new Promise(setImmediate); global.gc(); }
    assert.equal(typeof context.onCleanup, 'function');
    assert.equal(weak.deref(), undefined);
  `,
  ]);
});

test('instances are ready; token identity and scopes, not descriptions, determine reuse', async () => {
  const a = token(),
    b = token(),
    value = connection();
  let closed = 0;
  value.dispose = () => {
    closed++;
  };
  const scope = createProviderScope([provide(a, { useValue: value })]);
  assert.equal(scope.get(a), value);
  assert.equal(await scope.resolve(a), value);
  await assert.rejects(scope.resolve(b), /not registered/);
  assert.throws(() => scope.get(b), /not registered/);
  const other = createProviderScope([provide(a, { useValue: connection() })]);
  assert.notEqual(other.get(a), value);
  await scope.dispose();
  assert.equal(other.get(a).read(), 'value');
  assert.equal(closed, 0);
  await other.dispose();
});

test('concurrent async factory callers share initialization and synchronous get never starts work', async () => {
  const key = token(),
    gate = deferred(),
    value = connection();
  let calls = 0;
  const scope = createProviderScope([
    provide(key, {
      useFactory: () => {
        calls++;
        return gate.promise;
      },
    }),
  ]);
  assert.throws(() => scope.get(key), /not ready/);
  assert.equal(calls, 0);
  const first = scope.resolve(key),
    second = scope.resolve(key);
  assert.equal(first, second);
  await flush();
  assert.equal(calls, 1);
  assert.throws(() => scope.get(key), /not ready/);
  gate.resolve(value);
  assert.equal(await first, value);
  assert.equal(await second, value);
  assert.equal(scope.get(key), value);
  assert.equal(await scope.resolve(key), value);
  await scope.dispose();
});

test('sync factories initialize lazily once and unused factories never allocate', async () => {
  const key = token(),
    unused = token();
  let calls = 0;
  const scope = createProviderScope([
    provide(key, {
      useFactory: () => {
        calls++;
        return connection();
      },
    }),
    provide(unused, {
      useFactory: () => {
        throw new Error('unused');
      },
    }),
  ]);
  await scope.resolve(key);
  await scope.resolve(key);
  assert.equal(calls, 1);
  await scope.dispose();
});

test('registration captures settings and arrays while borrowed infrastructure stays mutable', async () => {
  const key = token(),
    factoryKey = token();
  const value = connection();
  let closed = 0;
  const config = {
    useValue: value,
    ownership: 'owned',
    dispose: () => {
      closed++;
    },
  };
  const factoryConfig = { useFactory: () => value };
  const registrations = [
    provide(key, config),
    provide(factoryKey, factoryConfig),
  ];
  config.dispose = () => {
    throw new Error('mutated');
  };
  config.useValue = connection();
  factoryConfig.useFactory = () => {
    throw new Error('mutated');
  };
  const scope = createProviderScope(registrations);
  registrations.length = 0;
  value.read = () => 'updated';
  assert.equal((await scope.resolve(factoryKey)).read(), 'updated');
  await scope.dispose();
  assert.equal(closed, 1);
});

test('unused owned instances transfer to a successfully created scope and close exactly once', async () => {
  const key = token();
  let closed = 0;
  const scope = createProviderScope([
    provide(key, {
      useValue: connection(),
      ownership: 'owned',
      dispose: () => {
        closed++;
      },
    }),
  ]);
  const first = scope.dispose();
  assert.equal(scope.dispose(), first);
  assert.throws(() => scope.get(key), /disposed/);
  await assert.rejects(scope.resolve(key), /disposed/);
  await first;
  assert.equal(closed, 1);
});

test('invalid registrations fail before scope ownership or any factory runs', () => {
  assert.throws(() => createProviderToken('', () => true), /description/);
  assert.throws(() => createProviderToken('x', undefined), /validator/);
  const key = token(),
    value = connection();
  assert.throws(
    () => provide(key, { useValue: value, useFactory: () => value }),
    /exactly one/,
  );
  assert.throws(() => provide(key, { useFactory: 3 }), /function/);
  assert.throws(
    () => provide(key, { useValue: value, ownership: 'owned' }),
    /require dispose/,
  );
  assert.throws(
    () => provide(key, { useValue: value, dispose() {} }),
    /borrowed/,
  );
  assert.throws(
    () => provide(key, { useValue: value, extra: true }),
    /Unknown/,
  );
  assert.throws(() => provide(key, { useValue: {} }), /does not satisfy/);
  assert.throws(
    () => provide({ description: 'connection' }, { useValue: value }),
    /Expected a token/,
  );
  assert.throws(() => createProviderScope([{}]), /Expected a registration/);
  let closed = 0,
    called = 0;
  const owned = provide(key, {
    useValue: value,
    ownership: 'owned',
    dispose() {
      closed++;
    },
  });
  assert.throws(
    () =>
      createProviderScope([
        owned,
        provide(key, {
          useFactory: () => {
            called++;
            return value;
          },
        }),
      ]),
    /Duplicate/,
  );
  assert.equal(closed, 0);
  assert.equal(called, 0);
});

test('factory failure is memoized; partial allocations clean in reverse order before rejection', async () => {
  for (const asynchronous of [false, true]) {
    const key = token(),
      original = new Error('connect failed'),
      events = [];
    let calls = 0;
    const scope = createProviderScope([
      provide(key, {
        useFactory: (context) => {
          calls++;
          context.onCleanup(() => {
            events.push('first');
          });
          context.onCleanup(async () => {
            events.push('second');
          });
          if (asynchronous) return Promise.reject(original);
          throw original;
        },
      }),
    ]);
    await assert.rejects(scope.resolve(key), (error) => error === original);
    assert.deepEqual(events, ['second', 'first']);
    await assert.rejects(scope.resolve(key), (error) => error === original);
    assert.throws(
      () => scope.get(key),
      (error) => error === original,
    );
    assert.equal(calls, 1);
    await scope.dispose();
    assert.deepEqual(events, ['second', 'first']);
  }
});

test('owned returned values clean before factory allocations; cleanup continues through errors', async () => {
  const key = token(),
    other = token(),
    events = [],
    failure = new Error('close failed');
  const scope = createProviderScope([
    provide(other, {
      useValue: connection(),
      ownership: 'owned',
      dispose: () => {
        events.push('other');
      },
    }),
    provide(key, {
      ownership: 'owned',
      dispose: () => {
        events.push('value');
        throw failure;
      },
      useFactory: ({ onCleanup }) => {
        onCleanup(() => {
          events.push('first');
        });
        onCleanup(async () => {
          events.push('second');
        });
        return connection();
      },
    }),
  ]);
  await scope.resolve(key);
  await assert.rejects(
    scope.dispose(),
    (error) =>
      error instanceof AggregateError && error.errors.includes(failure),
  );
  assert.ok(events.includes('other'));
  assert.deepEqual(
    events.filter((e) => e !== 'other'),
    ['value', 'second', 'first'],
  );
  await assert.rejects(scope.dispose(), AggregateError);
  assert.equal(events.length, 4);
});

test('initialization errors preserve their cause when partial cleanup also fails', async () => {
  const key = token(),
    original = new Error('init'),
    cleanup = new Error('cleanup');
  const scope = createProviderScope([
    provide(key, {
      useFactory: ({ onCleanup }) => {
        onCleanup(() => {
          throw cleanup;
        });
        throw original;
      },
    }),
  ]);
  await assert.rejects(
    scope.resolve(key),
    (error) =>
      error instanceof AggregateError &&
      error.cause === original &&
      error.errors[0] === original &&
      error.errors[1] === cleanup,
  );
  await assert.rejects(
    scope.dispose(),
    (error) => error instanceof AggregateError && error.errors[0] === cleanup,
  );
});

test('invalid factory capability cleans owned results and private allocations', async () => {
  const key = token(),
    events = [];
  const scope = createProviderScope([
    provide(key, {
      ownership: 'owned',
      dispose: (value) => {
        assert.deepEqual(value, {});
        events.push('value');
      },
      useFactory: ({ onCleanup }) => {
        onCleanup(() => {
          events.push('partial');
        });
        return {};
      },
    }),
  ]);
  await assert.rejects(scope.resolve(key), /does not satisfy/);
  assert.deepEqual(events, ['value', 'partial']);
  await scope.dispose();
});

test('disposal before a scheduled factory starts prevents initialization', async () => {
  const key = token();
  let calls = 0;
  const scope = createProviderScope([
    provide(key, {
      useFactory: () => {
        calls++;
        return connection();
      },
    }),
  ]);
  const resolution = scope.resolve(key);
  const stopped = scope.dispose();
  await assert.rejects(resolution, /disposed/);
  await stopped;
  assert.equal(calls, 0);
});

test('disposal rejects pending consumers, reclaims partial allocations and later owned results', async () => {
  const key = token(),
    gate = deferred(),
    events = [];
  let context;
  const scope = createProviderScope([
    provide(key, {
      ownership: 'owned',
      dispose: () => {
        events.push('late value');
      },
      useFactory: (input) => {
        context = input;
        input.onCleanup(() => {
          events.push('partial');
        });
        return gate.promise;
      },
    }),
  ]);
  const pending = scope.resolve(key);
  await flush();
  let done = false;
  const stopped = scope.dispose();
  void stopped.then(() => {
    done = true;
  });
  await assert.rejects(pending, /disposed/);
  await flush();
  assert.equal(context.signal.aborted, true);
  assert.deepEqual(events, ['partial']);
  assert.equal(done, false);
  context.onCleanup(() => {
    events.push('late allocation');
  });
  await flush();
  assert.deepEqual(events, ['partial', 'late allocation']);
  gate.resolve(connection());
  await stopped;
  assert.deepEqual(events, ['partial', 'late allocation', 'late value']);
  assert.throws(() => context.onCleanup(() => {}), /settled/);
});

test('late factory rejection after disposal is consumed and does not block another scope', async () => {
  const key = token(),
    gate = deferred();
  const a = createProviderScope([
    provide(key, { useFactory: () => gate.promise }),
  ]);
  const b = createProviderScope([provide(key, { useValue: connection() })]);
  const pending = a.resolve(key);
  await flush();
  const closing = a.dispose();
  await assert.rejects(pending, /disposed/);
  gate.reject(new Error('late'));
  await closing;
  assert.equal((await b.resolve(key)).read(), 'value');
  await b.dispose();
});

test('scope seals before cancellation and cleanup reentry and disposal keeps its identity', async () => {
  const key = token(),
    other = token(),
    gate = deferred();
  let nestedDispose,
    observed = false;
  const scope = createProviderScope([
    provide(other, { useValue: connection() }),
    provide(key, {
      useFactory: ({ signal, onCleanup }) => {
        signal.subscribe(() => {
          assert.throws(() => scope.get(other), /disposed/);
          nestedDispose = scope.dispose();
          observed = true;
          throw new Error('listener failure must not interrupt cleanup');
        });
        onCleanup(() => {
          assert.throws(() => scope.get(other), /disposed/);
        });
        return gate.promise;
      },
    }),
  ]);
  const pending = scope.resolve(key);
  await flush();
  const stopped = scope.dispose();
  assert.equal(observed, true);
  assert.equal(nestedDispose, stopped);
  await assert.rejects(pending, /disposed/);
  gate.resolve(connection());
  await stopped;
});

test('duplicate owned instances are rejected without closing the original owner', async () => {
  const first = token(),
    second = token(),
    value = connection();
  let closed = 0;
  const own = (key) =>
    provide(key, {
      useValue: value,
      ownership: 'owned',
      dispose: () => {
        closed++;
      },
    });
  assert.throws(
    () => createProviderScope([own(first), own(second)]),
    /only one owning/,
  );
  assert.equal(closed, 0);
  const scope = createProviderScope([
    own(first),
    provide(second, {
      useFactory: () => value,
      ownership: 'owned',
      dispose: () => {
        closed++;
      },
    }),
  ]);
  await assert.rejects(scope.resolve(second), /only one owning/);
  assert.equal(closed, 0);
  assert.equal(scope.get(first), value);
  await scope.dispose();
  assert.equal(closed, 1);
});

test('capability validator reentry cannot expose a factory result after scope disposal', async () => {
  let scope, closing;
  const key = createProviderToken('reentry', (value) => {
    closing = scope.dispose();
    return typeof value === 'object';
  });
  let closed = 0;
  scope = createProviderScope([
    provide(key, {
      useFactory: () => ({}),
      ownership: 'owned',
      dispose: () => {
        closed++;
      },
    }),
  ]);
  await assert.rejects(scope.resolve(key), /disposed/);
  await closing;
  assert.equal(closed, 1);
});

test('custom acquisition providers preserve shared addressing, consumer ownership and result validation', async () => {
  const key = createAcquisitionSourceToken();
  const selection = [
    { name: 'name', responseName: 'name', arguments: {}, children: [] },
  ];
  let reads = 0,
    closed = 0,
    malformed = false;
  const source = {
    stateAddress: 'custom:tenant-A',
    selection,
    read: async () => {
      reads++;
      return [
        {
          identity: { id: '1' },
          fields: [
            {
              kind: 'write',
              path: selection,
              value: malformed ? undefined : 'valid',
            },
          ],
        },
      ];
    },
    dispose: () => {
      closed++;
    },
  };
  const providers = createProviderScope([provide(key, { useValue: source })]);
  const client = new AcquisitionClient();
  try {
    const first = client.watch(await providers.resolve(key)),
      second = client.watch(providers.get(key));
    await Promise.all([first.ready, second.ready]);
    assert.equal(reads, 1);
    first.dispose();
    assert.equal(closed, 0);
    assert.equal(second.getSnapshot().records[0].data.name, 'valid');
    malformed = true;
    await assert.rejects(second.refresh());
    assert.equal(second.getSnapshot().records[0].data.name, 'valid');
  } finally {
    client.dispose();
    await providers.dispose();
  }
  assert.equal(closed, 0);
  assert.throws(
    () => provide(key, { useValue: { ...source, read: false } }),
    /does not satisfy/,
  );
});

test('get preserves the original initialization error while asynchronous cleanup is pending', async () => {
  const key = token(),
    cleanup = deferred(),
    original = new Error('factory failed');
  let cleaning = false;
  const scope = createProviderScope([
    provide(key, {
      useFactory: ({ onCleanup }) => {
        onCleanup(() => {
          cleaning = true;
          return cleanup.promise;
        });
        throw original;
      },
    }),
  ]);
  const pending = scope.resolve(key);
  await flush();
  assert.equal(cleaning, true);
  assert.throws(
    () => scope.get(key),
    (error) => error === original,
  );
  cleanup.resolve();
  await assert.rejects(pending, (error) => error === original);
  await scope.dispose();
});

test('supplied thenables are rejected instead of changing capability during promise assimilation', async () => {
  const key = token();
  let assimilated = 0;
  const thenable = {
    read() {},
    then(resolve) {
      assimilated++;
      resolve({ read: false });
    },
  };
  assert.throws(() => provide(key, { useValue: thenable }), /thenables/);
  assert.equal(assimilated, 0);
  const value = connection();
  const scope = createProviderScope([provide(key, { useValue: value })]);
  value.then = thenable.then;
  await assert.rejects(scope.resolve(key), /thenables/);
  assert.equal(assimilated, 0);
  await scope.dispose();
});

test('initialization failure cancels that provider before cleanup without cancelling healthy providers', async () => {
  const bad = token(),
    healthy = token();
  let failedSignal,
    healthySignal,
    cancelledBeforeCleanup = false;
  const scope = createProviderScope([
    provide(bad, {
      useFactory: ({ signal, onCleanup }) => {
        failedSignal = signal;
        onCleanup(() => {
          cancelledBeforeCleanup = signal.aborted;
        });
        throw new Error('failure');
      },
    }),
    provide(healthy, {
      useFactory: ({ signal }) => {
        healthySignal = signal;
        return connection();
      },
    }),
  ]);
  await scope.resolve(healthy);
  await assert.rejects(scope.resolve(bad), /failure/);
  assert.equal(failedSignal.aborted, true);
  assert.equal(cancelledBeforeCleanup, true);
  assert.equal(healthySignal.aborted, false);
  await scope.dispose();
  assert.equal(healthySignal.aborted, true);
});
