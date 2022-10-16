import { Dirent, existsSync, readdirSync } from "fs"
import { join as joinPath, parse as parsePath } from "path"
import { scopedCommand } from "../launch"
import { notNull } from "../utils/fp/common"
import { runInnerTests, runPintosPhase, runSpecificTest } from "./run"
import { TestItem } from "./TestItem"

export async function ensureLookupTestsInPhase({ onMissingLocation, generateId, isTest }: {
  onMissingLocation: (location: LookupLocation) => void
  generateId: TestIdGen
  isTest: IsTestChecker
}, location: LookupLocation): Promise<TestItem> {
  return await scopedCommand({
    cwd: location.phase,
    execute() {
      const phase = location.phase
      const path = location.path

      if (!existsSync(path)) {
        onMissingLocation(location)
      }

      const baseId = generateId({
        baseId: null,
        phase,
        segment: generateId({
          baseId: "tests",
          segment: phase,
          phase
        })
      })

      const dirents = readdirSync(path, { withFileTypes: true })
      const items = <TestItem[]> dirents.filter(isTest).map(dirent => lookupTests({
        dirent,
        baseId,
        phase,
        basePath: location.path,
        generateId,
        isTest
      })).filter(notNull)

      return new TestItem({
        id: baseId,
        basePath: "",
        name: phase,
        phase,
        items,
        run: runPintosPhase
      })
    }
  })
}

export function lookupTests({ dirent, baseId, basePath, phase, generateId, isTest }: {
  dirent: Dirent
  basePath: string
  baseId: string
  phase: string
  generateId: TestIdGen
  isTest: IsTestChecker
}): TestItem | null {
  const { name } = parsePath(dirent.name)
  const testId = generateId({
    baseId,
    phase,
    segment: dirent.isDirectory() ? dirent.name : name
  })

  if (dirent.isFile()) {
    return new TestItem({
      id: testId,
      basePath,
      phase,
      name,
      items: [],
      run: runSpecificTest
    })
  }

  const dir = joinPath(basePath, dirent.name)
  const dirents = readdirSync(dir, { withFileTypes: true })
  const items = <TestItem[]> dirents
    .filter(isTest)
    .map((dirent => lookupTests({ dirent, baseId: testId, phase, isTest, generateId, basePath: dir })))
    .filter(notNull)

  if (items.length === 0) {
    return null
  }

  return new TestItem({
    id: testId,
    basePath,
    name,
    items,
    phase,
    run: runInnerTests
  })
}

export interface LookupLocation {
  phase: string
  path: string
}

export type TestIdGen = (args: { phase: string, baseId: string | null, segment: string }) => string

export type IsTestChecker = (dirent: Dirent) => boolean
