import { executeCommand, spawnCommand } from "../launch"

export function compilePhase(phase: string) {
  return spawnCommand({
    cmd: "make",
    args: [],
    cwd: phase
  })
}

export function cleanAndCompilePhase(phase: string) {
  executeCommand({
    cmd: "make clean",
    cwd: phase
  })

  return compilePhase(phase)
}
