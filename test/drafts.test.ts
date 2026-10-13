// C77: a rebuild never reloads the page under his hands (Soushi, 2026-10-11 06:42: "Comment On..., because it is a popup is
// often dismissed while I'm writing because of a page reload, we need to fix this").
import { describe, expect, test } from "bun:test"
import { keepDrafts } from "../src/voice/drafts.ts"

// a stand-in page: the comment popup, the road box, focus, storage that survives a reload, and the timers run by hand
function page(store = new Map<string, string>()) {
  const listeners: Record<string, ((e?: any) => void)[]> = {}, timers: (() => void)[] = [], observers: (() => void)[] = []
  const cls = new Set<string>()
  const popText = { value: "" }, road = { value: "" }
  const pop = { classList: { contains: (c: string) => cls.has(c) }, querySelector: () => popText }
  const doc: any = { readyState: "complete", activeElement: null, getElementById: (id: string) => (id === "pinpop" ? pop : id === "roadText" ? road : null) }
  const win: any = {}
  const ss = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
  class MO { constructor(f: () => void) { observers.push(f) } observe() {} disconnect() {} }
  new Function("document", "window", "sessionStorage", "addEventListener", "MutationObserver", "setTimeout", keepDrafts)(
    doc, win, ss, (t: string, f: () => void) => (listeners[t] ??= []).push(f), MO, (f: () => void) => timers.push(f))
  return {
    store, popText, road, doc, writing: (waited = 0) => win.ddWriting(waited) as boolean,
    open: () => { cls.add("on"); observers.forEach((f) => f()) }, close: () => cls.delete("on"),
    fire: (t: string) => (listeners[t] ?? []).forEach((f) => f()), settle: () => timers.splice(0).forEach((f) => f()),
  }
}

describe("C77: his writing survives a rebuild", () => {
  test("the reload waits while the comment popup is open, a field has focus, or the road box holds unsent text", () => {
    const p = page()
    expect(p.writing()).toBe(false)
    p.open(); expect(p.writing()).toBe(true)
    p.close(); expect(p.writing()).toBe(false)
    p.doc.activeElement = { tagName: "TEXTAREA" }; expect(p.writing()).toBe(true)
    p.doc.activeElement = { tagName: "BUTTON" }; expect(p.writing()).toBe(false)
    p.road.value = "half a question"; expect(p.writing()).toBe(true)
  })

  test("a comment and a road message cut off by a reload anyway come back where they were", () => {
    const before = page()
    before.open(); before.popText.value = "This risk is overstated"; before.road.value = "should we camp?"
    before.fire("beforeunload")
    const after = page(before.store)
    after.settle()
    expect(after.road.value).toBe("should we camp?")
    expect(after.popText.value).toBe("") // the popup is closed after a reload: the comment waits for it to open
    after.open()
    expect(after.popText.value).toBe("This risk is overstated")
  })

  test("the served page carries it, ahead of the reload loop, and waits on it", async () => {
    const src = await Bun.file(new URL("../src/cli.ts", import.meta.url)).text()
    expect(src).toContain("${keepDrafts}let v=null,due=0")
    expect(src).toContain("if(due&&!window.ddWriting(Date.now()-due)){due=0;location.reload()}")
  })

  test("C94: a field that only has focus holds a reload 15 seconds at most; the popup and the road box hold it while they last", () => {
    const p = page()
    p.doc.activeElement = { tagName: "TEXTAREA" }
    expect(p.writing(14000)).toBe(true)
    expect(p.writing(16000)).toBe(false) // the coach has left: the farewell must not wait on a note field left focused
    p.open(); expect(p.writing(60000)).toBe(true)
    p.close(); p.road.value = "half a question"; expect(p.writing(60000)).toBe(true)
  })
})
