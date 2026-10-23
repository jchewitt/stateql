# Typed snapshot data

B7a carries a definition's inferred result through GraphQL handles and Angular query signals. It is pending a batched release and is absent from alpha.5. Storage, decoding, cache sharing, snapshot identity and notifications are unchanged; there is no extra projection object or runtime TypeScript dependency.

```ts
// invoices comes from a generated schema or an explicitly typed createSchema<Model>().
const selected = invoices.select({
  accountId: { as: 'account' },
  amountCents: true,
  user: { select: { name: true } },
});
const handle = client.watch(selected.bind(variables, scope));
await handle.ready;
const data = handle.getSnapshot().records?.[0]?.data;
const amount: number | undefined = data?.amountCents;
const name: string | undefined = data?.user?.name;
const account: string | undefined = data?.account;
```

The example assumes non-null scalar fields in that schema. Each scalar retains its declared type and nullability, plus possible absence. Aliases replace source names; unselected fields, including injected identity fields, are not exposed in `data`. Conditional selections and aliases remain optional, and alternative selections preserve their unions. Scalar arrays remain readonly and retain their declared element types/nullability; missing coverage does not turn array elements into optional properties.

## Availability remains explicit

`records` remains a readonly array, `null`, or `undefined`: these distinguish acquired records/empty lists, a null resource or ancestor, and unacquired data. Each record's `data` remains an object. Selected properties are readonly and optional recursively because partial reads or errors can leave them missing. Nested selected objects also permit `null` after structural failure, even when the schema declares that object non-null. Successful nullable scalar values remain distinct from absent values.

Neither `ready` settling nor `complete: true` proves that every schema field is usable. They do not narrow `data` to the full declared result. Continue inspecting field errors, resource errors, freshness and membership metadata, and handle missing values explicitly. A failed refresh may retain an earlier value; its inferred scalar type says nothing about freshness or server revision.

`ResultOf<typeof definition>` still represents the full declared selection. Core's `SnapshotData<ResultOf<typeof definition>>` describes its safely partial snapshot data. It is useful for shared presentation helpers, without adding runtime scalar casts:

```ts
type InvoiceData = SnapshotData<ResultOf<typeof selected>>;
function amountText(data: InvoiceData): string {
  return data.amountCents === undefined
    ? 'Unavailable'
    : (data.amountCents / 100).toFixed(2);
}
```

Import `SnapshotData` from `@tandrove/core` and `ResultOf` from `@tandrove/graphql`. For a nullable amount field, handle `null` separately too. The billing demo uses typed helpers while preserving its existing missing/null presentation.

## Framework and dynamic consumers

`injectStateQuery()` infers the same result from its open callback. Narrow `query.state()` to `status: 'active'` before reading `snapshot.records`; pending, disposed and binding-error states are unchanged. `tandroveSignal()` already preserves the reader's snapshot type. Angular AOT templates and native TypeScript consumers are checked against the same declaration files.

Dynamic `createSchema(sdl)` usage retains generic `InputObject`/`InputValue` data. A custom definition without a result witness, or an unknown/broad result model, does not gain guessed scalar types. Portable custom acquisition remains generic unless an adapter supplies a truthful typed contract. JavaScript execution is unchanged. Custom scalars and nested object-list acquisition remain unsupported by the current GraphQL source; this type improvement does not enable them or hydrate values into classes such as `Date`.

The public snapshot types accept an optional result parameter: `RecordSnapshot<Result>`, `StateSnapshot<Result>`, `StateView<Result>` and `QuerySnapshot<Result>`. `QueryHandle<Target, Result>` and Angular's `StateQuery<Target, Result>` append the result parameter; existing target-only usages keep generic JSON data. Typed handles can pass to existing generic readers/helpers. A private, optional declaration-only witness prevents an already untyped handle/snapshot from silently acquiring a specific schema model, including an all-optional selection. It creates no JavaScript property. As with any TypeScript API, explicit assertions or inaccurate manually maintained schema models can bypass static guarantees; prefer generated schema types.

## Migration and verification

Normal `client.watch(boundDefinition)` calls infer the new types automatically. Code that explicitly supplied a result type to `watch<Result>(...)` should remove that argument and use a typed bound definition. The generic parameter now describes the passed definition, rather than an arbitrary result claim. Keep `ResultOf` for full declared data and use `SnapshotData` for consumer snapshots. Existing generic `QueryHandle<Target>` helpers remain supported.

Snapshot, view, handle and Angular owned-query contracts now use type aliases over interfaces parameterized by their actual output. This preserves compatibility without allowing generic model comparisons to bypass the result witness. Declaration merging into those contracts is no longer supported; use an application-owned intersection type for additional metadata.

`pnpm demo:typescript` demonstrates typed scalar access and preserved cached siblings. Compile checks cover inference, aliases, optional/union selections, readonly data, scalar arrays, structural nulls, old consumer compatibility and unsafe narrowing. Runtime scenarios verify partial/error recovery, null/empty resources, unchanged peer snapshots and cache sharing. Packed-package acceptance checks native ESM execution, declarations and Angular AOT templates.
