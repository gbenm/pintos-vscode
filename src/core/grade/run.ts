import { join as joinPath } from "path"
import { executeCommand, spawnCommand } from "../launch"
import { TestItem, TestStatus } from "./TestItem"

export function runSpecificTest(item: TestItem): TestStatus {
  const result = executeCommand({
    cwd: item.phase,
    cmd: `make ${joinPath(item.basePath, item.name.concat(".result"))}`
  })

  const matches = result.toString().match(/^pass/mi)

  if (matches) {
    return "passed"
  }

  return "failed"
}

export function runInnerTests(item: TestItem): TestStatus {
  const allPassed = item.items.map(runSpecificTest).every(test => test === "passed")

  return allPassed ? "passed" : "failed"
}


export function runPintosPhase(item: TestItem): TestStatus {
  item.status = "started"
  const childProcess = spawnCommand({
    cmd: "make",
    args: [item.phase],
    cwd: item.phase
  })

  childProcess.stdout.on("data", (buffer: Buffer) => {
    const partialResult = buffer.toString()
    const passedTests = partialResult.match(/^pass.*/mig)?.map(extractTestName) || []
    const failedTests = partialResult.match(/^fail.*/mig)?.map(extractTestName) || []

    passedTests.forEach((test) => {
      // TODO: find the test and change the status
    })
    // TODO: do the same for failed Tests
  })

  childProcess.on("exit", () => {
    // TODO: set the rest of test to "errored"
  })

  throw new Error("not implemented")
}

function extractTestName(match: string): string | null {
  return match.match(/([^ ])\s(?<test>.*)/)?.groups?.test || null
}
