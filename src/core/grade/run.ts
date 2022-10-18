import { existsSync, readFileSync } from "fs"
import { childProcessToPromise, spawnCommand } from "../launch"
import { OutputChannel } from "../types"
import { curry, iterableForEach, waitMap } from "../utils/fp/common"
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
  iterableForEach(test => test.status = "started", item.testLeafs)

  await waitMap(test => test.run(output), Array.from(item.testLeafs))

  return item.status
}


export async function runPintosPhase(item: TestItem, output?: OutputChannel): Promise<TestStatus> {
  output?.appendLine(`test ${item.gid}`)
  iterableForEach(test => test.status = "started", item.testLeafs)

  const testProcess = spawnCommand({
    cmd: "make",
    args: ["grade"],
    cwd: item.phase
  })

  item.process = testProcess

  let status: TestStatus = "errored"
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

    iterableForEach((test) => {
      if (item.id.match(/dir-empty-name-persistence/)) {
        console.log(`${test.status} ${item.gid}`)
      }
      setStatusFromResultFile(test)
      if (test.status === "unknown") {
        test.status = "errored"
      }
    }, item.testLeafs, test => finalStates.includes(test.status))

    status = item.status
  } catch (e: any) {
    console.log(`[DEV Error] ${e}\n${e?.stack}`)
    status = "errored"
  } finally {
    output?.appendLine("")
    output?.appendLine(`exit with code ${testProcess.exitCode}`)

    return status
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
  } else {
    test.status = "unknown"
  }
}

function extractTestName(match: string): string | null {
  return match.match(/([^ ])\s(?<test>.*)/)?.groups?.test || null
}
