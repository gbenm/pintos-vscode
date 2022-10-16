import { Curry, FilterFn, LastFn, ObjectWith, UnionToIntersection } from "./types"

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

export const filtersAnd = <T, I>(...fns: FilterFn<T, I>[]): FilterFn<T, I> => (item,  index) => fns.map(fn => fn(item, index)).reduce((a, b) => a && b, true)

export function iterableForEach<T>(fn: (item: T, i: number) => void, iterator: Iterable<T>, skipElement?: (item: T, i: number) => boolean) {
  let i = 0
  if (skipElement) {
    for (let item of iterator) {
      if (skipElement(item, i)) {
        continue
      }

      fn(item, i++)
    }
  } else {
    for (let item of iterator) {
      fn(item, i++)
    }
  }
}
