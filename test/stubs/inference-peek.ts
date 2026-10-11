// a stand-in for the PAI Inference tool that records what the road page would read while he writes (C81)
import { join } from "node:path"
if (process.env.STUB_LOG) await Bun.write(process.env.STUB_LOG, await Bun.file(join(process.env.DD_TOWN_OUT!, "road", "caretaker.json")).text().catch(() => "none"))
console.log("By the fire, then.")
export {}
