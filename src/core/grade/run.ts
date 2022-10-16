import { join as joinPath } from "path"
import { childProcessToPromise, spawnCommand } from "../launch"
import { TestItem, TestStatus } from "./TestItem"

export async function runSpecificTest(item: TestItem): Promise<TestStatus> {
  const testProcess = spawnCommand({
    cwd: item.phase,
    cmd: "make",
    args: [joinPath(item.basePath, item.name.concat(".result"))]
  })

  item.process = testProcess

  try {
    const result = await childProcessToPromise({ process: testProcess })

    const matches = result.toString().match(/^pass/mi)

    if (matches) {
      return "passed"
    }

    return "failed"
  } catch {
    return "errored"
  }
}

export async function runInnerTests(item: TestItem): Promise<TestStatus> {
  const testResults = await Promise.all(item.items.map(runSpecificTest))
  const allPassed = testResults.every(test => test === "passed")

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
