import { TestItem } from "../grade/TestItem"
import { spawnCommand } from "../launch"

/**
 * Start a pintos GDB server, assumes that cwd is the root of the pintos code folder
 */
export default function ({
  test,
  emu = "qemu",
  scheduler
}: {
  test: TestItem
  emu?: "qemu" | "bochs"
  scheduler: "priority" | "mlfqs"
}) {
  if (test.isComposite) {
    throw new Error("can't debug a composite test")
  }

  const args = [
    "-v", // No VGA display or keyboard
    "--gdb", // Debug with gdb
    `--${emu}`, // select emulator
    "--", // foward options to pintos kernel
    "-q"
  ]

  if (scheduler === "mlfqs") {
    args.push("-mlfqs")
  }

  args.push("run", test.name)

  return spawnCommand({
    cwd: test.phase,
    cmd: "pintos",
    args
  })
}
