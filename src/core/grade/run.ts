import { existsSync, readFileSync } from "fs"
import { childProcessToPromise, spawnCommand } from "../launch"
import { curry, iterableForEach, waitMap } from "../utils/fp/common"
import { finalStates, TestItem, TestRunRequest, TestStatus } from "./TestItem"

export async function runSpecificTest({ item, output }: TestRunRequest): Promise<TestStatus> {
  if (item.isComposite) {
    throw new Error(`${item.name} must be a file test`)
  }

  output?.appendLine(`start ${item.id}`)

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

export async function runInnerTests({ item, ...context }: TestRunRequest): Promise<TestStatus> {
  context.output?.appendLine(`start ${item.id}`)

  await waitMap(test => test.run(context), Array.from(item.testLeafs))

  return item.status
}


export async function runPintosPhase({ item, output }: TestRunRequest): Promise<TestStatus> {
  output?.appendLine(`start ${item.gid}`)

  let status: TestStatus = "errored"
  try {
    const testProcess = spawnCommand({
      cmd: "make",
      args: ["grade"],
      cwd: item.phase
    })

    item.process = testProcess

    iterableForEach(setStatusFromResultFile, item.testLeafs)

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

          const test = item.lookup({
            by: "testid",
            search: testId
          })

          if (test && !test.isComposite) {
            test.status = status
          }

          throw new Error(`${testId} not found in TestItems`)
        })

        passedTests.forEach(setStatus("passed"))
        failedTests.forEach(setStatus("failed"))
      }
    })

    if (item.isComposite) {
      iterableForEach(test => test.status = "errored", item.testLeafs, test => test.status !== "unknown" && finalStates.includes(test.status))
    } else if (testProcess.exitCode !== 0 && finalStates.includes(item.status)) {
      status = "errored"
    }


    status = item.status
  } catch (e: any) {
    console.log(`[DEV Error] ${e}\n${e?.stack}`)
    status = "errored"
  } finally {
    output?.appendLine("")
    output?.appendLine(`exit with code ${item.process?.exitCode}`)

    if (!item.isComposite) {
      item.status = status
    }

    return status
  }
}

export function setStatusFromResultFile(test: TestItem) {
  const { backless, status } = getTestStateFromResultFile(test.resultFile)
  test.status = status
  test.backless = backless
}

export function getTestStateFromResultFile (file: string) {
  const exists = existsSync(file)
  let status: TestStatus = "unknown"

  if (exists) {
    const content = readFileSync(file).toString()
    const [_, pass, fail] = content.match(/(^pass)|(^fail)/mi) || []

    if (pass) {
      status = "passed"
    } else if (fail) {
      status = "failed"
    } else {
      status = "errored"
    }
  }

  return { status, backless: !exists }
}

function extractTestName(match: string): string | null {
  return match.match(/([^ ])\s(?<test>.*)/)?.groups?.test || null
}
