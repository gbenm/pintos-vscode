import { join as joinPath } from "path"
import { childProcessToPromise, spawnCommand } from "../launch"
import { OutputChannel } from "../types"
import { curry, iterableForEach } from "../utils/fp/common"
import { finalStates, TestItem, TestStatus } from "./TestItem"

export async function runSpecificTest(item: TestItem, output?: OutputChannel): Promise<TestStatus> {
  if (item.isComposite) {
    throw new Error("must be a file test")
  }

  output?.appendLine(`test ${item.id}`)
  item.status = "started"

  const testProcess = spawnCommand({
    cwd: item.phase,
    cmd: "make",
    args: [joinPath(item.basePath, item.name.concat(".result"))]
  })

  item.process = testProcess

  try {
    const result = (await childProcessToPromise({ process: testProcess })).toString()
    output?.appendLine(result)

    const matches = result.match(/^pass/mi)

    if (matches) {
      return "passed"
    }

    return "failed"
  } catch {
    return "errored"
  }
}

export async function runInnerTests(item: TestItem, output?: OutputChannel): Promise<TestStatus> {
  output?.appendLine(`test ${item.id}`)
  iterableForEach(test => test.status = "queued", item, test => test.isComposite)

  const testResults = await Promise.all(
    Array.from(item, test => test.run(output))
  )

  const allPassed = testResults.every(test => test === "passed")

  return allPassed ? "passed" : "failed"
}


export async function runPintosPhase(item: TestItem, outputChannel?: OutputChannel): Promise<TestStatus> {
  outputChannel?.appendLine(`test ${item.id}`)
  iterableForEach(test => test.status = "queued", item, test => test.isComposite)

  const testProcess = spawnCommand({
    cmd: "make",
    args: ["grade"],
    cwd: item.phase
  })

  try {
    await childProcessToPromise({
      process: testProcess,
      onData(buffer: Buffer) {
        const partialResult = buffer.toString()
        outputChannel?.append(partialResult)

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

    outputChannel?.appendLine("")

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
