import * as assert from "assert"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import path = require("path")
import { ensureLookupTestsInPhase } from "../../core/grade/lookup"
import { TestItem, TestStatus } from "../../core/grade/TestItem"
import { generateTestId, isTest } from "../../core/grade/utils"
import { executeCommand, scopedCommand } from "../../core/launch"
import { prop } from "../../core/utils/fp/common"

suite("Test Items", () => {
  test("get all tests ids", () => {
    const run = () => <TestStatus> "passed"

    const mainTest = new TestItem({
      id: "tests/threads",
      basePath: "build/tests/threads",
      items: [
        new TestItem({
          id: "tests/threads/test1",
          basePath: "build/tests/threads",
          items: [],
          name: "test1",
          phase: "threads",
          run
        }),
        new TestItem({
          id: "tests/threads/nested",
          basePath: "build/tests/threads",
          items: [
            new TestItem({
              id: "tests/threads/nested/test1",
              basePath: "build/tests/threads/nested",
              items: [],
              name: "test1",
              phase: "threads",
              run
            }),
            new TestItem({
              id: "tests/threads/nested/test2",
              basePath: "build/tests/threads/nested",
              items: [],
              name: "test2",
              phase: "threads",
              run
            }),
          ],
          name: "nested",
          phase: "threads",
          run
        }),
        new TestItem({
          id: "tests/threads/test2",
          basePath: "build/tests/threads",
          items: [],
          name: "test2",
          phase: "threads",
          run
        })
      ],
      name: "threads",
      phase: "threads",
      run
    })

    assert.deepEqual(
      Array.from(mainTest, prop("id")),
      [
        "tests/threads",
        "tests/threads/test1",
        "tests/threads/nested",
        "tests/threads/nested/test1",
        "tests/threads/nested/test2",
        "tests/threads/test2"
      ]
    )
  })

  test("discover tests", async () => {
    await scopedCommand({
      cwd: ".testWorkspace",
      tempDir: true,
      async execute() {
        createTestsFiles([
          "threads/build/tests/test1.o",
          "threads/build/tests/test2.o",
          "threads/build/tests/otherfile.d",
          "threads/build/tests/nested/test1.o",
          "threads/build/tests/nested/test2.o",
          "threads/build/tests/nested/otherfile.d",
          "userprog/build/tests/test1.o",
          "userprog/build/tests/test2.o",
        ])

        const path = "build/tests"

        const getTestsFrom = ensureLookupTestsInPhase.bind(null, {
          onMissingLocation({ path }) {
            throw new Error(`[Dev] ${path} is missing`)
          },
          generateId: generateTestId,
          isTest
        })

        const threadsTest = await getTestsFrom({
          phase: "threads",
          path
        })

        assert.deepEqual(
          Array.from(threadsTest, prop("id")).sort(),
          [
            "tests/threads",
            "tests/threads/test1",
            "tests/threads/test2",
            "tests/threads/nested",
            "tests/threads/nested/test1",
            "tests/threads/nested/test2",
          ].sort()
        )

        const userprogTest = await getTestsFrom({
          phase: "userprog",
          path
        })

        assert.deepEqual(
          Array.from(userprogTest, prop("id")).sort(),
          [
            "tests/userprog",
            "tests/userprog/test1",
            "tests/userprog/test2",
          ].sort()
        )
      },
    })
  })
})

function createTestsFiles (files: string[]) {
  files.forEach((file) => {
    const parentPath = path.dirname(file)
    if (!existsSync(parentPath)) {
      mkdirSync(parentPath, { recursive: true })
    }

    writeFileSync(file, "temp file")
  })
}
