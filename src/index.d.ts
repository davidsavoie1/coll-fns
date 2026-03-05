export type AnyObject = Record<string, any>;
export type MaybePromise<T> = T | Promise<T>;
export type Selector = AnyObject | string;

export type FieldValue = 0 | 1 | boolean | number | FieldSpec;
export interface FieldSpec {
  [key: string]: FieldValue;
}

export interface FetchOptions<TDoc = AnyObject> extends AnyObject {
  fields?: FieldSpec;
  sort?: AnyObject;
  limit?: number;
  skip?: number;
  transform?: ((doc: TDoc) => any) | null;
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

export type JoinArrayProp = string | [string];
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

export type PublishJoinSelector = [string | [string], string | [string], AnyObject?];

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

export interface PublishChildArgs<TParent = AnyObject> extends AnyObject {
  Coll?: any;
  join?: string;
  on?: PublishSelector<TParent>;
  /** Backward-compatible alias for `on`. */
  selector?: PublishSelector<TParent>;
  fields?: FieldSpec;
  children?: Array<PublishChildArgs<TParent> | false | null | undefined>;
  deps?: PublishDeps<TParent>;
  debug?: boolean | Record<string, boolean>;
}

export interface PublishOptions<TParent = AnyObject> extends AnyObject {
  fields?: FieldSpec;
  children?: Array<PublishChildArgs<TParent> | false | null | undefined>;
  deps?: PublishDeps<TParent>;
  debug?: boolean | Record<string, boolean>;
  maxConcurrent?: number;
  waitForAll?: boolean;
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

export function fetchList<TColl, TDoc = AnyObject>(
  Coll: TColl,
  selector?: AnyObject,
  options?: FetchOptions<TDoc>
): MaybePromise<TDoc[]>;

export function fetchOne<TColl, TDoc = AnyObject>(
  Coll: TColl,
  selector: AnyObject,
  options?: FetchOptions<TDoc>
): MaybePromise<TDoc | undefined>;

export function fetchIds<TColl, TId = string>(
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
  joins?: Record<string, JoinDef> | null | undefined | false
): void;

export function getJoins<TColl>(Coll: TColl): Record<string, JoinDef>;
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
): MaybePromise<{ stop: () => void }>;

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
  meteorAsync: Protocol;
  meteorSync: Protocol;
  node: Protocol;
};
