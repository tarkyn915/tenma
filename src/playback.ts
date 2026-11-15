/** Fisher–Yates shuffle: return a new array and preserve every queue entry, including duplicates. */
export function shuffledItems<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Reorder an existing queue without changing the current track object or mutating the source. */
export function queueAroundTrack<T>(original: readonly T[], current: T | undefined, shuffle: boolean): { queue: T[]; index: number } {
  if (current === undefined || !original.includes(current)) return { queue: [...original], index: original.length ? 0 : -1 };
  const index = original.indexOf(current);
  if (!shuffle) return { queue: [...original], index };
  const remaining = original.filter((_, entryIndex) => entryIndex !== index);
  return { queue: [current, ...shuffledItems(remaining)], index: 0 };
}
