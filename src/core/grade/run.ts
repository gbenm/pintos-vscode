import { existsSync, readFileSync } from "fs"
import { childProcessToPromise } from "../launch"
import { curry, iterableForEach, waitMap } from "../utils/fp/common"
import { finalStates, TestItem, TestRunRequest, TestStatus } from "./TestItem"

export async function runSpecificTest({ item, output, shell }: TestRunRequest): Promise<TestStatus> {
  if (item.isComposite) {
    throw new Error(`${item.name} must be a file test`)
  }

  output?.appendLine(startMessageOf(item))

  const testProcess = shell.make({
    cwd: item.phase,
    args: [item.makefileTarget]
  })

  item.process = testProcess

  let status: TestStatus = "errored"
  let changeLastExecutionTime = true
  const startTime = Date.now()
  try {
    const result = (await childProcessToPromise({ process: testProcess })).toString()
    output?.appendLine(result)

    const [_, pass, fail] = result.match(/(^pass)|(^fail)/mi) || []

    if (pass) {
      status = "passed"
    } else if (fail) {
      status = "failed"
    } else {
      const state = getTestStateFromResultFile(item.resultFile)
      status = state.status

      if (status === "unknown") {
        status = "errored"
      } else {
        changeLastExecutionTime = false // the result comes from filesystem
      }
    }
  } finally {
    if (changeLastExecutionTime) {
      item.lastExecutionTime = Date.now() - startTime
    }
    return status
  }
}

export async function runInnerTests({ item, ...context }: TestRunRequest): Promise<TestStatus> {
  context.output?.appendLine(startMessageOf(item))

  await waitMap(test => test.run(context), Array.from(item.testLeafs))

  return item.status
}


export async function runPintosPhase({ item, output, shell }: TestRunRequest): Promise<TestStatus> {
  output?.appendLine(startMessageOf(item))

  let status: TestStatus = "errored"

  try {
    const testProcess = shell.make({
      args: ["grade"],
      cwd: item.phase
    })

    item.process = testProcess

    let start = Date.now()
    await childProcessToPromise({
      process: testProcess,
      onData(buffer: Buffer) {
        const partialResult = buffer.toString()
        output?.append(partialResult)
        const end = Date.now()

        const passedTests = partialResult.match(/^pass.*/mig)?.map(extractTestName) || []
        const failedTests = partialResult.match(/^fail.*/mig)?.map(extractTestName) || []

        let anyResultFromThisBuffer = false
        const estimatedExecutionTime = (end - start) / (passedTests.length + failedTests.length)
        const setStatus = curry((status: TestStatus, testId: string | null): void => {
          if (!testId) {
            throw new Error(`${testId} not found in TestItems`)
          }

          const test = item.lookup({
            by: "testid",
            search: testId
          })

          if (test && !test.isComposite) {
            test.lastExecutionTime = estimatedExecutionTime
            test.status = status
            anyResultFromThisBuffer = true
          }
        })

        passedTests.forEach(setStatus("passed"))
        failedTests.forEach(setStatus("failed"))

        if (anyResultFromThisBuffer) {
          start = end
        }
      }
    })

    iterableForEach(setStatusFromResultFile, item.testLeafs, test => finalStates.includes(test.status))

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

    return status
  }
}

const startMessageOf = ({ id, phase }: TestItem) => `[start] <${phase}> ${id}\n`

export function setStatusFromResultFile(test: TestItem<any>) {
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
