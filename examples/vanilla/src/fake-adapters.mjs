import { resourceAddress, freezeFields, selectFieldPath } from '@tandrove/core';

const selection = freezeFields(
  ['accountId', 'amount'].map((name) => ({
    name,
    responseName: name,
    arguments: {},
    children: [],
  })),
);

/** @param {string} scope */
export function createWholeResourceFixture(scope) {
  let version = 1;
  let reads = 0;
  let hold = false;
  /** @type {undefined | (() => void)} */
  let release;
  /** @type {import('@tandrove/core').AcquisitionSource} */
  const source = {
    stateAddress: resourceAddress({ source: 'fake-whole-resource', scope }, [
      { name: 'invoices', arguments: {} },
    ]),
    selection,
    collection: true,
    fetchSelection: () => selection,
    read: async () => {
      reads++;
      const records = [
        {
          identity: { id: 'invoice-1' },
          fields: [
            {
              kind: /** @type {const} */ ('write'),
              path: [{ name: 'accountId', arguments: {} }],
              value: `${scope}-account-v${version}`,
            },
            {
              kind: /** @type {const} */ ('write'),
              path: [{ name: 'amount', arguments: {} }],
              value: version * 10,
            },
          ],
        },
      ];
      if (hold) {
        hold = false;
        await new Promise((resolve) => {
          release = () => resolve(undefined);
        });
      }
      return records;
    },
  };
  return {
    source,
    reads: () => reads,
    advance: () => {
      version++;
    },
    holdNext: () => {
      hold = true;
    },
    waiting: () => release !== undefined,
    release: () => {
      const done = release;
      release = undefined;
      done?.();
    },
  };
}

/** A deliberately tiny in-process event adapter, with explicit routing and cleanup. */
export function createEventFixture() {
  /** @type {Set<(event: { address: string, id: string, accountId: string }) => void>} */
  const listeners = new Set();
  return {
    /**
     * @param {import('@tandrove/core').AcquisitionClient} client
     * @param {import('@tandrove/core').AcquisitionSource} source
     */
    connect(client, source) {
      /** @param {{ address: string, id: string, accountId: string }} event */
      const receive = (event) => {
        if (event.address !== source.stateAddress) return;
        if (
          typeof event.id !== 'string' ||
          !event.id ||
          typeof event.accountId !== 'string'
        )
          throw new Error('Invalid fake account event.');
        client.ingest(source, {
          selection: selectFieldPath(source.selection, ['accountId']),
          records: [
            {
              identity: { id: event.id },
              fields: [
                {
                  kind: 'write',
                  path: [{ name: 'accountId', arguments: {} }],
                  value: event.accountId,
                },
              ],
            },
          ],
        });
      };
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    },
    /** @param {{ address: string, id: string, accountId: string }} event */
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    listeners: () => listeners.size,
  };
}
