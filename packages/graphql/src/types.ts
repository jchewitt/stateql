/** Generated schema contract; carries type information without runtime values. */
export interface ObjectRef<Name extends string> {
  readonly object: Name;
}
export interface FieldType<Value, Args extends object = Record<never, never>> {
  readonly value: Value;
  readonly args: Args;
}
export type SchemaTypes = Record<
  string,
  Record<string, FieldType<unknown, object>>
>;
type Value<F> = F extends FieldType<infer V, object> ? V : never;
type Args<F> = F extends FieldType<unknown, infer A> ? A : never;
type ObjectName<V> = V extends readonly (infer Item)[]
  ? ObjectName<Item>
  : V extends ObjectRef<infer N>
    ? N
    : never;
export type Child<
  S extends SchemaTypes,
  N extends keyof S,
  K extends keyof S[N],
> = ObjectName<Value<S[N][K]>> & keyof S;
export type ObjectKeys<S extends SchemaTypes, N extends keyof S> = {
  [K in keyof S[N]]: [Child<S, N, K>] extends [never] ? never : K;
}[keyof S[N]] &
  string;
type ArgumentOption<A> = {} extends A
  ? { readonly args?: A }
  : { readonly args: A };
type FieldSelection<S extends SchemaTypes, F> = [ObjectName<Value<F>>] extends [
  never,
]
  ? | ({} extends Args<F> ? true : never)
    | (ArgumentOption<Args<F>> & { readonly as?: string })
  : ArgumentOption<Args<F>> & {
      readonly as?: string;
      readonly select: Selection<S, ObjectName<Value<F>> & keyof S>;
    };
export type Selection<S extends SchemaTypes, N extends keyof S> = {
  readonly [K in keyof S[N]]?: FieldSelection<S, S[N][K]>;
};
type ExactConfigArgs<F, T> = T extends { args: infer A }
  ? { args: Record<Exclude<keyof A, keyof Args<F>>, never> }
  : unknown;
export type ExactSelection<S extends SchemaTypes, N extends keyof S, T> = {
  [K in keyof T]: K extends keyof S[N]
    ? T[K] extends { select: infer Nested }
      ? { select: ExactSelection<S, Child<S, N, K>, Nested> } & Record<
          Exclude<keyof T[K], 'as' | 'args' | 'select'>,
          never
        > &
          ExactConfigArgs<S[N][K], T[K]>
      : T[K] extends object
        ? Record<Exclude<keyof T[K], 'as' | 'args'>, never> &
            ExactConfigArgs<S[N][K], T[K]>
        : unknown
    : never;
};
type ProjectValue<
  S extends SchemaTypes,
  V,
  T,
> = V extends readonly (infer Item)[]
  ? readonly ProjectValue<S, Item, T>[]
  : V extends ObjectRef<infer N>
    ? T extends { select: infer Nested }
      ? Result<S, N & keyof S, Nested>
      : never
    : V;
type ResponseKeys<K, Config> = Config extends unknown
  ? Config extends { as: infer Alias extends string }
    ? Alias
    : 'as' extends keyof Config
      ? K | Extract<Config['as'], string>
      : K
  : never;
type IsUnion<T, Whole = T> = T extends Whole
  ? [Whole] extends [T]
    ? false
    : true
  : never;
type CertainKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K>
    ? never
    : string extends ResponseKeys<K, NonNullable<T[K]>>
      ? never
      : true extends IsUnion<ResponseKeys<K, NonNullable<T[K]>>>
        ? never
        : K;
}[keyof T];
export type Result<
  S extends SchemaTypes,
  N extends keyof S,
  T,
> = T extends unknown ? ResultObject<S, N, T> : never;
type ResultObject<S extends SchemaTypes, N extends keyof S, T> = {
  readonly [
    K in CertainKeys<T> & keyof S[N] as ResponseKeys<K, NonNullable<T[K]>>
  ]: ProjectValue<S, Value<S[N][K]>, NonNullable<T[K]>>;
} & {
  readonly [
    K in Exclude<keyof T, CertainKeys<T>> & keyof S[N] as ResponseKeys<
      K,
      NonNullable<T[K]>
    >
  ]?: ProjectValue<S, Value<S[N][K]>, NonNullable<T[K]>>;
};
export type PathArgs<
  S extends SchemaTypes,
  N extends keyof S,
  K extends keyof S[N],
  P extends string,
> = keyof Args<S[N][K]> extends never
  ? Record<never, never>
  : {} extends Args<S[N][K]>
    ? { readonly [Key in P]?: Args<S[N][K]> }
    : { readonly [Key in P]: Args<S[N][K]> };
export type ExactArguments<Expected, Actual> = Actual &
  Record<Exclude<keyof Actual, keyof Expected>, never> & {
    [K in keyof Actual & keyof Expected]: Record<
      Exclude<keyof Actual[K], keyof NonNullable<Expected[K]>>,
      never
    >;
  };
type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];
type MergeConfig<A, B> = A extends { select: infer AS }
  ? B extends { select: infer BS }
    ? Omit<B, 'select'> & { readonly select: MergeSelection<AS, BS> }
    : B
  : B;
type MergeValue<A, B, K> = K extends keyof B
  ? K extends keyof A
    ? | MergeConfig<NonNullable<A[K]>, NonNullable<B[K]>>
      | ({} extends Pick<B, K> ? NonNullable<A[K]> : never)
      | ({} extends Pick<A, K> ? NonNullable<B[K]> : never)
    : B[K]
  : K extends keyof A
    ? A[K]
    : never;
export type MergeSelection<A, B> = A extends unknown
  ? B extends unknown
    ? MergeObject<A, B>
    : never
  : never;
type MergeObject<A, B> = {
  readonly [K in RequiredKeys<A> | RequiredKeys<B>]: MergeValue<A, B, K>;
} & {
  readonly [
    K in Exclude<keyof A | keyof B, RequiredKeys<A> | RequiredKeys<B>>
  ]?: MergeValue<A, B, K>;
};
type Unwrap<V> = V extends readonly (infer I)[] ? Unwrap<I> : NonNullable<V>;
export type FieldPaths<T> = {
  [K in keyof T & string]: Unwrap<T[K]> extends object
    ? K | `${K}.${FieldPaths<Unwrap<T[K]>>}`
    : K;
}[keyof T & string];
export type ResultOf<T> = T extends { readonly resultType?: infer R }
  ? R
  : never;
