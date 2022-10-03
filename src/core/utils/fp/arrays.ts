export function ensureSingleValue<T, K>(reducer: (values: T[]) => K, maybeValues: T[] | K) {
  if (Array.isArray(maybeValues)) {
    return reducer(maybeValues)
  }

  return maybeValues
}
