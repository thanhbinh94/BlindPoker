export function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = []
  const pick: T[] = []
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push(pick.slice())
      return
    }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]!)
      walk(i + 1)
      pick.pop()
    }
  }
  walk(0)
  return out
}
