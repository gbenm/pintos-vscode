import { access, unlink, writeFileSync } from "fs"
import { dirname, basename } from "path"
import { OutputChannel } from "vscode"
import { childProcessToPromise } from "../launch"
import { compilePhase } from "./compile"
import { genDiscoverMakefileContent, TestDirLocator, TestIdGen, TestIdSplitter } from "./lookup"

export const getDirOfTest: TestDirLocator = (testId) => `build/${dirname(testId)}`

export const getNameOfTest: (testId: string) => string = basename

export const generateTestId: TestIdGen = ({ baseId, segment }) => {
  if (baseId) {
    return `${baseId}/${segment}`
  }

  return segment
}

export const splitTestId: TestIdSplitter = (testId) => testId.split("/")

export function onMissingDiscoverMakefile (discoverMakefileName: string) {
  writeFileSync(discoverMakefileName, genDiscoverMakefileContent())
}

export async function onMissingTestDir ({ phase, output }: { phase?: string, output?: OutputChannel } = {}) {
  await childProcessToPromise({
    process: compilePhase(phase),
    onData (buffer: Buffer) {
      output?.append(buffer.toString())
    }
  })
}

export function rmfile(file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    unlink(file, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function existsfile(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    access(file, (error) => {
      if (error) {
        resolve(false)
      } else {
        resolve(true)
      }
    })
  })
}
