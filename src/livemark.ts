// Where a restarted live stream resumes (C62). Trip folders are named generated_<n>_<id>, and the number does not follow the
// trips' age (the Warrens trip, generated_2_*, came after the Cove's generated_3_*), so pages are never ordered by their path:
// they are ordered by when they were saved, then by page number within a trip (pm#19, 2026-10-11 04:46: a restart mid-fight
// replayed about 650 old lines, and the mark then sat on an old trip's last page, muting the new trip).

export interface PageFile { path: string; mtime: number }
const trip = (p: string) => p.split("/").slice(-2, -1)[0] ?? ""
const num = (p: string) => Number(p.match(/(\d+)\.json$/)?.[1] ?? 0)

/** Pages in the order they were saved: by save time, then within a trip by page number. */
export function inOrder(pages: PageFile[]): PageFile[] {
  return [...pages].sort((a, b) => a.mtime - b.mtime || (trip(a.path) === trip(b.path) ? num(a.path) - num(b.path) : a.path.localeCompare(b.path)))
}

/** The pages already told when the stream starts: all of them but the last `replay` when replaying; else, against the mark,
 *  the mark's own trip up to its page and every other trip's pages saved no later than it; with no mark, all of them. */
export function alreadyTold(pages: PageFile[], mark: string, replay = 0): Set<string> {
  const ordered = inOrder(pages)
  if (replay > 0) return new Set(ordered.slice(0, Math.max(0, ordered.length - replay)).map((p) => p.path))
  const at = mark ? pages.find((p) => p.path === mark) : undefined
  if (!at) return new Set(pages.map((p) => p.path))
  return new Set(pages.filter((p) => trip(p.path) === trip(at.path) ? num(p.path) <= num(at.path) : p.mtime <= at.mtime).map((p) => p.path))
}
