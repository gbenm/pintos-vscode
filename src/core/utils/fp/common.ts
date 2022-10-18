import { FunctionsOf } from "../../types"
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

export const capitalize = (text: string) => text
  .split(" ")
  .map(word => word.split(""))
  .map(([letter, ...rest]) => letter?.toUpperCase().concat(rest.join("")) || "")
  .join(" ")

export const notNull = <T>(item: T) => item !== null

export const filtersAnd = <T, I>(...fns: FilterFn<T, I>[]): FilterFn<T, I> => (item,  index) => fns.map(fn => fn(item, index)).reduce((a, b) => a && b, true)

export async function waitMap<T, K>(fn: (v: T) => Promise<K>, items: T[]): Promise<K[]> {
  const result: K[] = []
  for (let item of items) {
    const test = await fn(item)
    result.push(test)
  }
  return result
}

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

export function bind<T extends object>(source: T): FunctionsOf<T> {
  const memo: Map<string | symbol, unknown> = new Map()
  return <FunctionsOf<T>> new Proxy(source, {
    get(target: any, fnKey) {
      if (!memo.has(fnKey)) {
        memo.set(fnKey, target[fnKey]?.bind(target))
      }

      return memo.get(fnKey)
    }
  })
}

export function iterLikeTolist<T>(collection: { forEach: (iter: (e: T) => void) => void }): T[] {
  const list: T[] = []
  collection.forEach(e => list.push(e))
  return list
}
