import { Curry, LastFn, UnionToIntersection } from "./types"

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
