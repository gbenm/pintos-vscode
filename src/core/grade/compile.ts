import { executeCommand, spawnCommand } from "../launch"

export function compilePhase(dir?: string) {
  return spawnCommand({
    cmd: "make",
    args: [],
    cwd: dir
  })
}

export function cleanAndCompilePhase(phase: string) {
  executeCommand({
    cmd: "make clean",
    cwd: phase
  })

  return compilePhase(phase)
}
