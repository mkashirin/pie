import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(process.execPath, [
    "--test",
    fileURLToPath(new URL("./smoke.test.mjs", import.meta.url)),
], {
    stdio: "inherit",
    env: { ...process.env, PI_LSP_RUNTIME_SMOKE: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
