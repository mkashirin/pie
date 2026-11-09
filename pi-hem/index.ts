// Keep Pi discovery at the package root; implementation lives in src/.
export { default } from "./src/index.ts";
export { HelixEditor } from "./src/index.ts";
export { graphemes, HelixBuffer, type Mode, type RangeEdit, type Selection } from "./src/model.ts";
export { CommandController, type CommandOptions, type CommandView } from "./src/commands.ts";
export { InputDecoder, type InputEvent } from "./src/input.ts";
export { RegisterBank, type RegisterOperation, type RegisterValue } from "./src/registers.ts";
