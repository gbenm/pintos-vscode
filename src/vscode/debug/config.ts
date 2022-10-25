import { uriFromCurrentWorkspace } from "../utils"

export function addGdbMacrosToPath () {
  process.env.GDBMACROS = uriFromCurrentWorkspace("misc", "gdb-macros").fsPath
}

export function pintosGdbConfig ({ phase }: { phase: string }) {
 return {
    name: "PintOS GDB",
    type: "cppdbg",
    request: "launch",
    miDebuggerPath: "${workspaceRoot}/utils/pintos-gdb",
    program: `\${workspaceRoot}/${phase}/build/kernel.o`,
    cwd: `\${workspaceRoot}/${phase}/build`,
    miDebuggerServerAddress: "localhost:1234"
  }
}
