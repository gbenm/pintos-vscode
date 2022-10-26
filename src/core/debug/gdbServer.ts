import { ChildProcessWithoutNullStreams } from "node:child_process"
import { TestItem } from "../grade/TestItem"
import PintosShell from "../launch/PintosShell"
import { KernelScheduler, PintosSimulator } from "../launch/types"

/**
 * Start a pintos GDB server, assumes that cwd is the root of the pintos code folder
 */
export default function ({
  test,
  simulator = "qemu",
  scheduler,
  shell
}: {
  test: TestItem
  simulator?: PintosSimulator
  scheduler: KernelScheduler
  shell: PintosShell
}): ChildProcessWithoutNullStreams {
  if (test.isComposite) {
    throw new Error("can't debug a composite test")
  }

  return shell
    .pintos({ cwd: test.phase })
      .noVGA()
      .debug()
      .simulator(simulator)
    .kernel()
      .autoPowerOff()
      .scheduler(scheduler)
      .run(test.name)
    .spawn()
}
