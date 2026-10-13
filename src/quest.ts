// What the road's quest asks and how far along it is (C68), read from the save: the goal on `raid.raid_instance.goal_ids`,
// its definition in `campaign/quest/quest.types.json`, and its progress kept under the goal's own id on the raid instance
// (`explore_all_rooms: { explored_room_count: 8, target_room_count: 8 }`). Soushi, 2026-10-11 05:19: track the quest status.
import { nameOf, questGoal, strings, text } from "./game.ts"

export interface QuestStatus { name: string; asks: string; done: number; of: number; complete: boolean }

let goals: Map<string, any> | undefined
const words = (id: string) => id.replace(/_/g, " ")

/** The quest of the raid on this raw page, in words, with its progress; undefined when the page holds no raid. */
export async function questStatus(raw: any): Promise<QuestStatus | undefined> {
  const ri = raw?.raid?.raid_instance
  const id = Array.isArray(ri?.goal_ids) ? String(ri.goal_ids[0] ?? "") : ""
  if (!ri || !id) return undefined
  goals ??= new Map(JSON.parse(await text("campaign/quest/quest.types.json")).goals.map((g: any) => [g.id, g]))
  const g = goals.get(id), d = g?.data ?? {}, s = await strings()
  // the progress: the target, and the count beside it, whatever the goal calls them
  const prog = ri[id] ?? {}, nums = Object.entries<any>(prog).filter(([, v]) => typeof v === "number")
  // a gather goal keeps no count of its own (raid_instance.gather_medicines is {} on the Weald's page 0089, 2026-10-11): its target
  // is the goal's item amount, and what is gathered is what the party carries of that item (U39)
  const want = g?.type === "gather" ? d.item : undefined
  const carried = want ? Object.values<any>(raw?.raid?.party?.inventory?.items ?? {}).filter((i) => i.type === want.type && i.id === want.id).reduce((t, i) => t + Number(i.amount ?? 0), 0) : 0
  const of = Number(nums.find(([k]) => /^target/.test(k))?.[1] ?? want?.amount ?? d.amount ?? 0)
  const done = want && !nums.length ? carried : Number(nums.find(([k]) => !/^target/.test(k))?.[1] ?? 0)
  const pct = (p: number) => `${Math.round(p * 100)}%`
  const asks = g?.type === "explore_room" ? `explore ${d.percentage >= 1 ? "every room" : `${pct(d.percentage)} of the rooms`}`
    : g?.type === "battle_room" ? (d.percentage >= 1 ? "win the battle in every room" : `win ${pct(d.percentage)} of the room battles`)
    : g?.type === "gather" ? `gather ${d.item?.amount ?? of} ${words(d.item?.id ?? "items")}`
    : g?.type === "activate" ? `use ${d.amount ?? of} ${s.get(`str_curio_title_${d.curio_name}`) ?? words(d.curio_name ?? "curios")}`
    : g?.type === "kill_monster" ? `kill the ${await nameOf("monster", d.monster_class_ids?.[0] ?? "")}`
    : words(id)
  return { name: await questGoal(String(ri.type ?? ""), String(ri.dungeon ?? ""), Number(ri.length ?? 0), String(ri.id ?? "")), asks, done, of, complete: of > 0 && done >= of }
}

/** One line: "Scout: explore 90% of the rooms, 8 of 8, done". */
export const questLine = (q: QuestStatus) => `${q.name}: ${q.asks}, ${q.done} of ${q.of}${q.complete ? ", done" : ""}`
