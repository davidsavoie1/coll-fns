export type AnyObject = Record<string, any>;
export type MaybePromise<T> = T | Promise<T>;
export type Selector = AnyObject | string;

export type FieldValue = 0 | 1 | boolean | number | FieldSpec;
export interface FieldSpec {
  [key: string]: FieldValue;
}

export interface FetchOptions<TDoc = AnyObject, TResult = TDoc>
  extends AnyObject {
  ctx?: JoinContext;
  fields?: FieldSpec;
  sort?: AnyObject;
  limit?: number;
  skip?: number;
  transform?: ((doc: TDoc) => TResult) | null;
}

export interface Protocol<TColl = any, TDoc = AnyObject> {
  count: (
    Coll: TColl,
    selector?: AnyObject,
    options?: AnyObject
  ) => MaybePromise<number>;
  findList: (
    Coll: TColl,
    selector?: AnyObject,
    options?: AnyObject
  ) => MaybePromise<TDoc[]>;
  observe: (
    Coll: TColl,
    selector?: AnyObject,
    callbacks?: {
      added?: (id: any, fields: AnyObject) => any;
      changed?: (id: any, fields: AnyObject) => any;
      removed?: (id: any) => any;
    },
    options?: AnyObject
  ) => MaybePromise<{ stop: () => void }>;
  stringify: (value: any) => string;
  getName?: (Coll: TColl) => string;
  getTransform?: (Coll: TColl) => ((doc: TDoc) => any) | undefined;
  bindEnvironment?: <TArgs extends any[], TRet>(
    fn: (...args: TArgs) => TRet
  ) => (...args: TArgs) => TRet;
  insert: (
    Coll: TColl,
    doc: AnyObject,
    options?: AnyObject
  ) => MaybePromise<any>;
  remove: (
    Coll: TColl,
    selector: AnyObject,
    options?: AnyObject
  ) => MaybePromise<number>;
  update: (
    Coll: TColl,
    selector: AnyObject,
    modifier: AnyObject,
    options?: AnyObject
  ) => MaybePromise<number>;
}

/** A dot-notation field path, optionally wrapped to mark it as array-valued. */
export type JoinArrayProp = string | [string];
/** Array join relation: [parentPath, joinedPath, additionalSelector?]. */
export type JoinArrayOn =
  | [JoinArrayProp, JoinArrayProp]
  | [JoinArrayProp, JoinArrayProp, AnyObject];
export type JoinFunctionOn<TParent = AnyObject> = (doc: TParent) => AnyObject;
export type JoinObjectOn = AnyObject;
export type JoinOn<TParent = AnyObject> =
  | JoinArrayOn
  | JoinFunctionOn<TParent>
  | JoinObjectOn;

export interface JoinDef<TParent = AnyObject> extends AnyObject {
  Coll: any;
  on: JoinOn<TParent>;
  single?: boolean;
  postFetch?: (joined: any[] | any, parent: TParent) => any;
  deps?: FieldSpec;
  /** Backward-compatible alias for `deps`. */
  fields?: FieldSpec;
  limit?: number;
}

export type JoinDefinitions<TParent = AnyObject> = Record<
  string,
  JoinDef<TParent> | null | undefined | false
>;

/** Minimal contract accepted by fetch and publish for resolving joins. */
export interface JoinContext {
  getJoins<TColl>(
    Coll: TColl
  ): JoinDefinitions | null | undefined;
  getJoinPrefix?(): string | null;
}

/** Reusable local context created by createJoinContext(). */
export interface LocalJoinContext extends JoinContext {
  getJoinPrefix(): string | null;
  join<TColl>(
    Coll: TColl,
    joins?: JoinDefinitions | null | undefined | false
  ): this;
  setJoinPrefix(prefix: string | null): this;
}

export interface JoinContextOptions {
  defaultToGlobal?: boolean;
  prefix?: string | null;
}

export type HookType =
  | "beforeInsert"
  | "beforeUpdate"
  | "beforeRemove"
  | "onInserted"
  | "onUpdated"
  | "onRemoved";

export type HookFn = (...args: any[]) => any | Promise<any>;
export type HookUnlessPredicate = (...args: any[]) => boolean | Promise<boolean>;
export type HookWhenPredicate = (...args: any[]) => boolean | Promise<boolean>;

export interface HookDef {
  before?: boolean;
  fields?: FieldSpec | true;
  fn: HookFn;
  onError?: (err: Error, hookDef: EnhancedHookDef) => void;
  unless?: HookUnlessPredicate;
  when?: HookWhenPredicate;
}

export interface EnhancedHookDef extends HookDef {
  Coll: any;
  collName: string;
  hookType: HookType;
  onError: (err: Error, hookDef: EnhancedHookDef) => void;
}

export interface PoolCall {
  _id: symbol;
  fn: (...args: any[]) => any;
  args?: any[];
}

export type PoolOverflow =
  | "drop"
  | "shift"
  | ((pendings: PoolCall[], call: PoolCall) => PoolCall[] | undefined);

export interface PoolConfig {
  maxConcurrent?: number;
  maxPending?: number;
  onError?: (error: unknown, call: PoolCall) => void;
  onOverflow?: PoolOverflow;
}

export interface SoftRemoveRegistrationOptions<TDoc = AnyObject> {
  when?: (doc: TDoc) => boolean | Promise<boolean>;
  docToCollSelectorPairs?: (
    doc: TDoc
  ) =>
    | Array<[any, AnyObject | string]>
    | Promise<Array<[any, AnyObject | string]>>;
  fields?: FieldSpec;
  keepModifier?:
    | AnyObject
    | (() => AnyObject | Promise<AnyObject>)
    | null
    | undefined;
}

export interface SoftRemoveOptions {
  detailed?: boolean;
}

export type PublishJoinSelector = JoinArrayOn;

export type PublishSelector<TParent = AnyObject> =
  | AnyObject
  | ((parent?: TParent, ...ancestors: AnyObject[]) => MaybePromise<AnyObject>)
  | PublishJoinSelector;

export type PublishDeps<TParent = AnyObject> =
  | boolean
  | string
  | string[]
  | Set<string>
  | AnyObject
  | ((
      fields: AnyObject,
      parent?: TParent,
      ...ancestors: AnyObject[]
    ) => MaybePromise<
      boolean | string | string[] | Set<string> | AnyObject | undefined
    >)
  | undefined;

export type PublishFieldMapping =
  | ((value: any) => any)
  | Record<string, (value: any) => any>;

export type PublishFieldMappings = Record<string, PublishFieldMapping>;
export type PublishFieldMappingsOption =
  | PublishFieldMappings
  | false
  | null
  | undefined;

export interface PublishChildArgs<TParent = AnyObject> extends AnyObject {
  Coll?: any;
  join?: string;
  on?: PublishSelector<TParent>;
  /** Backward-compatible alias for `on`. */
  selector?: PublishSelector<TParent>;
  fields?: FieldSpec;
  /** Stateless field mappings applied immediately before publication. */
  mappings?: PublishFieldMappingsOption;
  children?: Array<PublishChildArgs<TParent> | false | null | undefined>;
  deps?: PublishDeps<TParent>;
  awaited?: boolean;
  debug?: boolean | string[] | Record<string, boolean>;
}

export interface PublishOptions<TParent = AnyObject> extends AnyObject {
  ctx?: JoinContext;
  fields?: FieldSpec;
  /** Stateless field mappings applied immediately before publication. */
  mappings?: PublishFieldMappingsOption;
  children?: Array<PublishChildArgs<TParent> | false | null | undefined>;
  debug?: boolean | string[] | Record<string, boolean>;
  maxConcurrent?: number;
}

export interface PublicationContext {
  added?: (collectionName: string, id: any, fields: AnyObject) => void;
  changed?: (collectionName: string, id: any, fields: AnyObject) => void;
  removed?: (collectionName: string, id: any) => void;
  ready: () => void;
  error?: (error: unknown) => void;
  onStop?: (fn: () => void) => void;
}

export function count<TColl>(
  Coll: TColl,
  selector: AnyObject,
  options?: AnyObject
): MaybePromise<number>;

export function fetchList<
  TColl,
  TDoc = AnyObject,
  TResult = TDoc,
>(
  Coll: TColl,
  selector?: AnyObject,
  options?: FetchOptions<TDoc, TResult>
): MaybePromise<TResult[]>;

export function fetchOne<
  TColl,
  TDoc = AnyObject,
  TResult = TDoc,
>(
  Coll: TColl,
  selector: AnyObject,
  options?: FetchOptions<TDoc, TResult>
): MaybePromise<TResult | undefined>;

export function fetchIds<TColl, TId = any>(
  Coll: TColl,
  selector: AnyObject,
  options?: FetchOptions
): MaybePromise<TId[]>;

export function exists<TColl>(
  Coll: TColl,
  selector: AnyObject
): MaybePromise<boolean>;

export function flattenFields(
  fields?: FieldSpec,
  root?: string
): Record<string, boolean> | FieldSpec | undefined;

export function hook<TColl>(
  Coll: TColl,
  hooksObj: Partial<Record<HookType, HookDef[]>>
): void;

export function insert<TColl>(Coll: TColl, doc: AnyObject): MaybePromise<any>;

export function join<TColl>(
  Collection: TColl,
  joins?: JoinDefinitions | null | undefined | false
): void;

export function createJoinContext(
  options?: JoinContextOptions
): LocalJoinContext;

export function getJoins<TColl>(
  Coll: TColl
): JoinDefinitions;
export function getJoinPrefix(): string | null;
export function setJoinPrefix(prefix: string | null): void;

export function remove<TColl>(
  Coll: TColl,
  selector: AnyObject
): MaybePromise<number>;

export function configurePool(config?: PoolConfig): void;

export function publish(
  publication: PublicationContext,
  Coll: any,
  selector: PublishSelector,
  options?: PublishOptions
): Promise<{ stop: () => void } | undefined>;

export function setProtocol<TColl = any, TDoc = AnyObject>(
  methods?: Partial<Protocol<TColl, TDoc>>
): void;

export function registerSoftRemove<TColl, TDoc = AnyObject>(
  Coll: TColl,
  options?: SoftRemoveRegistrationOptions<TDoc>
): void;

export function softRemove<TColl>(
  Coll: TColl,
  selector?: Selector,
  keepModifier?:
    | AnyObject
    | (() => AnyObject | Promise<AnyObject>)
    | null
    | undefined,
  options?: SoftRemoveOptions
): MaybePromise<number | { removed: number; updated: number | null }>;

export function update<TColl>(
  Coll: TColl,
  selector: AnyObject,
  modifier: AnyObject,
  options?: AnyObject
): MaybePromise<number>;

export const protocols: {
  meteorAsync: Partial<Protocol>;
  meteorSync: Partial<Protocol>;
  node: Partial<Protocol>;
};
