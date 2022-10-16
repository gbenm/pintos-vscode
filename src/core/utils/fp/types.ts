export type LastFn<T> = T extends [...((...v: any[]) => any)[], infer U extends (...args: any[]) => any] ? U : never
export type ObjectWith<T extends string | symbol | number> = {
  [k in T]: unknown
}
export type First<AofT> = AofT extends [infer F, ...any[]] ? F : never
export type WithoutFirst<AofT> = AofT extends [any, ...(infer Rest extends Array<any>)] ? Rest : never
export type RestOfA<AofT, Taken extends any[]> = AofT extends [...Taken, ...(infer Rest extends Array<any>)] ? Rest : never
export type IfAisEmpty<AofT, Then, Else> = AofT extends [] ? Else : Then
export type PartialArray<AofT> = AofT extends [...(infer Rest extends Array<any>), any] ? PartialArray<Rest> | AofT : never
export type UnionToIntersection<U> =
  (U extends unknown ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

export type Curry<Params extends Array<any>, Return> =
  (
  Params extends [any]
    ? Return
    : Params extends [...(infer Rest extends Array<any>), infer L]
        ? (...args: Rest) => (...args: [L]) => Curry<[L], Return>
        : never
  ) & (
    Params extends [any]
      ? Return
      : Params extends [infer F, ...(infer Rest extends Array<any>)]
          ? (...args: [F]) => Curry<Rest, Return>
          : never
  ) & (
    (...args: Params) => Return
  )
