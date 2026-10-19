import { getNamedType, isObjectType } from 'graphql';
import {
  fieldAddress,
  mergeFields,
  narrowFields,
  resourceAddress,
  selectFieldPath,
  type FieldSegment,
  type InputObject,
  type ResolvedField,
  type ResourceScope,
  type AcquisitionSource,
} from '@jchewitt/stateql-core';
import { decodeAcquisition, validateAcquisition } from './decoder.js';
import { compileOperation, type PreparedOperation } from './operation.js';
import {
  containsList,
  fieldAt,
  inspectSchema,
  inputObject,
  resolveArguments,
  resolveSelection,
  type SchemaContext,
  type SchemaOptions,
} from './schema.js';
import type {
  Child,
  ExactArguments,
  ExactSelection,
  FieldPaths,
  MergeSelection,
  ObjectKeys,
  PathArgs,
  Result,
  SchemaTypes,
  Selection,
} from './types.js';

export interface PathNode {
  readonly parentType: string;
  readonly name: string;
}

export class Resource<
  S extends SchemaTypes,
  N extends keyof S,
  A extends object,
  P extends string,
> {
  constructor(
    private readonly context: SchemaContext,
    private readonly typeName: string,
    private readonly path: readonly PathNode[] = [],
  ) {
    Object.freeze(this);
  }

  field<K extends ObjectKeys<S, N>>(
    name: K,
  ): Resource<
    S,
    Child<S, N, K>,
    A & PathArgs<S, N, K, P extends '' ? K : `${P}.${K}`>,
    P extends '' ? K : `${P}.${K}`
  > {
    const last = this.path.at(-1);
    if (last && containsList(fieldAt(this.context, last.parentType, last.name)))
      throw new Error(
        'Traverse list items using a nested selection, not a resource path.',
      );
    const field = fieldAt(this.context, this.typeName, name);
    const target = getNamedType(field.type);
    if (!isObjectType(target))
      throw new Error('Resource paths must end in an object.');
    return new Resource(
      this.context,
      target.name,
      Object.freeze([
        ...this.path,
        Object.freeze({ parentType: this.typeName, name }),
      ]),
    );
  }

  select<const T extends Selection<S, N>>(
    selection: T & ExactSelection<S, N, T>,
  ): Definition<S, N, A, T> {
    if (!this.path.length) throw new Error('Select a resource path first.');
    return new Definition(
      this.context,
      this.typeName,
      this.path,
      resolveSelection(this.context, this.typeName, selection),
    );
  }
}

export class Definition<
  S extends SchemaTypes,
  N extends keyof S,
  A extends object,
  T,
> {
  declare readonly resultType?: Result<S, N, T>;
  constructor(
    private readonly context: SchemaContext,
    private readonly typeName: string,
    private readonly path: readonly PathNode[],
    readonly selection: readonly ResolvedField[],
  ) {
    Object.freeze(this);
  }

  select<const Next extends Selection<S, N>>(
    selection: Next & ExactSelection<S, N, Next>,
  ): Definition<S, N, A, Next> {
    return new Definition(
      this.context,
      this.typeName,
      this.path,
      narrowFields(
        this.selection,
        resolveSelection(this.context, this.typeName, selection),
      ),
    );
  }

  extend<const Next extends Selection<S, N>>(
    selection: Next & ExactSelection<S, N, Next>,
  ): Definition<S, N, A, MergeSelection<T, Next>> {
    return new Definition(
      this.context,
      this.typeName,
      this.path,
      mergeFields(
        this.selection,
        resolveSelection(this.context, this.typeName, selection),
      ),
    );
  }

  bind<const Actual extends A>(
    argumentsByPath: ExactArguments<A, Actual>,
    scope: ResourceScope,
  ): BoundDefinition<Result<S, N, T>> {
    const input = inputObject(argumentsByPath);
    const allowed = new Set<string>();
    const segments: FieldSegment[] = [];
    for (const node of this.path) {
      const path = [...segments.map((segment) => segment.name), node.name].join(
        '.',
      );
      allowed.add(path);
      segments.push(
        Object.freeze({
          name: node.name,
          arguments: resolveArguments(
            fieldAt(this.context, node.parentType, node.name),
            input[path] === undefined ? {} : input[path],
          ),
        }),
      );
    }
    for (const key of Object.keys(input))
      if (!allowed.has(key)) throw new Error(`Unknown argument path: ${key}`);
    return new BoundDefinition(
      this.context,
      this.path,
      Object.freeze(segments),
      this.selection,
      Object.freeze({ source: scope.source, scope: scope.scope }),
    );
  }
}

export class BoundDefinition<R> {
  declare readonly resultType?: R;
  readonly stateAddress: string;
  constructor(
    private readonly context: SchemaContext,
    private readonly path: readonly PathNode[],
    readonly segments: readonly FieldSegment[],
    readonly selection: readonly ResolvedField[],
    scope: ResourceScope,
  ) {
    this.stateAddress = resourceAddress(scope, segments);
    Object.freeze(this);
  }

  prepare(target?: FieldPaths<R>): PreparedOperation {
    const fields =
      target === undefined
        ? this.selection
        : selectFieldPath(this.selection, target.split('.'));
    return compileOperation(
      this.context,
      this.path,
      this.segments,
      fields,
      this.stateAddress,
    );
  }

  /** Provisional execution boundary; read coverage is always a validated subset. */
  asSource(
    transport: (operation: PreparedOperation) => Promise<unknown>,
  ): AcquisitionSource {
    validateAcquisition(this.context, this.path, this.selection);
    // Validate the initial operation (including list identities) before scheduling work.
    this.prepare();
    const last = this.path.at(-1)!;
    return Object.freeze({
      stateAddress: this.stateAddress,
      selection: this.selection,
      collection: containsList(
        fieldAt(this.context, last.parentType, last.name),
      ),
      read: async (fields: readonly ResolvedField[]) => {
        const selection = narrowFields(this.selection, fields);
        const operation = compileOperation(
          this.context,
          this.path,
          this.segments,
          selection,
          this.stateAddress,
        );
        return decodeAcquisition(
          this.context,
          this.path,
          operation,
          await transport(operation),
        );
      },
    });
  }

  address(target: FieldPaths<R>, recordIdentity?: InputObject): string {
    const selected = selectFieldPath(this.selection, target.split('.'));
    const path: FieldSegment[] = [];
    let fields = selected;
    for (const _part of target.split('.')) {
      const field = fields[0]!;
      path.push({ name: field.name, arguments: field.arguments });
      fields = field.children;
    }
    return fieldAddress(this.stateAddress, path, recordIdentity);
  }
}

export function createSchema<S extends SchemaTypes>(
  source: string,
  options: SchemaOptions = {},
): Resource<S, 'Query' & keyof S, Record<never, never>, ''> {
  const context = inspectSchema(source, options);
  if (context.schema.getQueryType()!.name !== 'Query')
    throw new Error('This prototype requires a query root named Query.');
  return new Resource(context, 'Query');
}
