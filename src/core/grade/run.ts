import { join as joinPath } from "path"
import { childProcessToPromise, spawnCommand } from "../launch"
import { curry } from "../utils/fp/common"
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


export async function runPintosPhase(item: TestItem): Promise<TestStatus> {
  item.status = "started"
  const testProcess = spawnCommand({
    cmd: "make",
    args: [item.phase],
    cwd: item.phase
  })

  try {
    await childProcessToPromise({
      process: testProcess,
      onData(buffer: Buffer) {
        const partialResult = buffer.toString()
        const passedTests = partialResult.match(/^pass.*/mig)?.map(extractTestName) || []
        const failedTests = partialResult.match(/^fail.*/mig)?.map(extractTestName) || []
        const setStatus = curry((status: TestStatus, testId: string | null): void => {
          if (!testId) {
            return
          }

          const test = item.lookup(testId)

          if (test) {
            test.status = status
          }

          throw new Error(`${testId} not found in TestItems`)
        })

        passedTests.forEach(setStatus("passed"))
        failedTests.forEach(setStatus("failed"))
      }
    })

    const finalStates: TestStatus[] = ["passed", "failed", "skipped", "errored"]
    for (let test of item) {
      if (test.isComposite) {
        continue
      }

      if (!finalStates.includes(test.status)) {
        test.status = "errored"
      }
    }

    return item.status
  } catch {
    return "errored"
  }
}

function extractTestName(match: string): string | null {
  return match.match(/([^ ])\s(?<test>.*)/)?.groups?.test || null
}
