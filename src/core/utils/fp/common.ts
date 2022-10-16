import { Curry, LastFn, ObjectWith, UnionToIntersection } from "./types"

export function compose<BR, FNS extends [...((...v: any[]) => any)[]]>(
  baseFn: (v: any) => BR,
  ...otherFns: FNS
): (...args: Parameters<LastFn<FNS>>) => BR {
  const fns = [baseFn, ...otherFns]
  // @ts-ignore
  return (...args: unknown[]) => fns.reduceRight((res, fn) => [fn(...res)], args)[0]
}

export function curry<Fn extends (...args: any[]) => any>(fn: Fn): UnionToIntersection<Curry<Parameters<Fn>, ReturnType<Fn>> & typeof fn> {
  const arity = fn.length

  // @ts-ignore
  return function $curry(...args) {
    // @ts-ignore
    if (args.length < arity) {
      // @ts-ignore
      return $curry.bind(null, ...args)
    }

    // @ts-ignore
    return fn.call(null, ...args)
  }
}

export function prop <T extends string>(prop: T): <O extends ObjectWith<T>>(obj: O) => typeof obj[typeof prop]
export function prop <T extends string, O extends ObjectWith<T>>(prop: T, obj: O): typeof obj[typeof prop]
export function prop <T extends string, O extends ObjectWith<T>>(prop: T, obj?: O): ((obj: O) => typeof obj[typeof prop]) | O[T] {
  if (obj) {
    return obj[prop]
  }

  return obj => obj[prop]
}

export const notNull = <T>(item: T) => item !== null
