import { existsSync, readFileSync } from "fs"
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
    args: [item.makefileTarget]
  })

  item.process = testProcess

  let status: TestStatus = "errored"
  try {
    const result = (await childProcessToPromise({ process: testProcess })).toString()
    output?.appendLine(result)

    const [_, pass, fail] = result.match(/(^pass)|(^fail)/mi) || []

    if (pass) {
      status = "passed"
    } else if (fail) {
      status = "failed"
    } else {
      setStatusFromResultFile(item)
    }
  } finally {
    if (!finalStates.includes(item.status)) {
      item.status = status
    }
    return status
  }
}

export async function runInnerTests(item: TestItem, output?: OutputChannel): Promise<TestStatus> {
  output?.appendLine(`test ${item.id}`)
  iterableForEach(test => test.status = "queued", item, test => test.isComposite)

  await Promise.all(
    Array.from(item).filter(test => !test.isComposite).map(test => test.run(output))
  )

  return item.status
}


export async function runPintosPhase(item: TestItem, output?: OutputChannel): Promise<TestStatus> {
  output?.appendLine(`test ${item.id}`)
  iterableForEach(test => test.status = "queued", item, test => test.isComposite)

  const testProcess = spawnCommand({
    cmd: "make",
    args: ["grade"],
    cwd: item.phase
  })

  item.process = testProcess

  try {
    await childProcessToPromise({
      process: testProcess,
      onData(buffer: Buffer) {
        const partialResult = buffer.toString()
        output?.append(partialResult)

        const passedTests = partialResult.match(/^pass.*/mig)?.map(extractTestName) || []
        const failedTests = partialResult.match(/^fail.*/mig)?.map(extractTestName) || []

        const setStatus = curry((status: TestStatus, testId: string | null): void => {
          if (!testId) {
            return
          }

          const test = item.lookup(testId)

          if (test && !test.isComposite) {
            test.status = status
          }

          throw new Error(`${testId} not found in TestItems`)
        })

        passedTests.forEach(setStatus("passed"))
        failedTests.forEach(setStatus("failed"))
      }
    })

    output?.appendLine("")
    output?.appendLine(`exit with code ${testProcess.exitCode}`)

    iterableForEach(setStatusFromResultFile, item, test => test.isComposite || finalStates.includes(test.status))

    return item.status
  } catch {
    return "errored"
  }
}

export function setStatusFromResultFile(test: TestItem) {
  if (existsSync(test.resultFile)) {
    const content = readFileSync(test.resultFile).toString()
    const [_, pass, fail] = content.match(/(^pass)|(^fail)/mi) || []

    if (pass) {
      test.status = "passed"
    } else if (fail) {
      test.status = "failed"
    } else {
      test.status = "errored"
    }
  }
}

function extractTestName(match: string): string | null {
  return match.match(/([^ ])\s(?<test>.*)/)?.groups?.test || null
}
