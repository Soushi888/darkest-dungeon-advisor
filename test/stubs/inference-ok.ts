// a stand-in for the PAI Inference tool: records how it was called, answers with a fixed line (C64)
const [, , ...args] = process.argv
if (process.env.STUB_LOG) await Bun.write(process.env.STUB_LOG, JSON.stringify(args))
console.log("The Shaman is down — press the last Grouper before it heals.")
export {}
