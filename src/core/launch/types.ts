export interface SpawnOptions {
  cmd: string
  args: readonly string[]
  cwd?: string,
  env?: Readonly<NodeJS.ProcessEnv>
}

export interface SpawnRequestOptions extends SpawnOptions {
  /** when the value is false, tree-kill lib is used to kill the process */
  nativeKill: boolean
}

export type PintosSimulator = "qemu" | "bochs"

export type KernelScheduler = "default" | "mlfqs"
