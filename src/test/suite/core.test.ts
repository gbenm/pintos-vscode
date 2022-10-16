import * as assert from "assert"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import path = require("path")
import { ensureLookupTestsInPhase } from "../../core/grade/lookup"
import { TestItem, TestStatus } from "../../core/grade/TestItem"
import { generateTestId, isRootTest, isTest } from "../../core/grade/utils"
import { scopedCommand } from "../../core/launch"
import { prop } from "../../core/utils/fp/common"

const run = () => <TestStatus> "passed"

suite("Test Items", () => {
  test("get all tests ids", () => {
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
          "threads/build/tests/threads/test1.o",
          "threads/build/tests/threads/test2.o",
          "threads/build/tests/threads/otherfile.d",
          "threads/build/tests/threads/nested/test1.o",
          "threads/build/tests/threads/nested/test2.o",
          "threads/build/tests/threads/nested/otherfile.d",
          "userprog/build/tests/userprog/test1.o",
          "userprog/build/tests/userprog/test2.o",
        ])

        const path = "build/tests"

        const getTestsFrom = ensureLookupTestsInPhase.bind(null, {
          onMissingLocation({ path }) {
            throw new Error(`[Dev] ${path} is missing`)
          },
          generateId: generateTestId,
          isTest,
          isRootTest
        })

        const threadsTest = await getTestsFrom({
          phase: "threads",
          path
        })

        assert.deepEqual(
          Array.from(threadsTest, prop("id")).sort(),
          [
            "tests",
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
            "tests",
            "tests/userprog",
            "tests/userprog/test1",
            "tests/userprog/test2",
          ].sort()
        )
      },
    })
  })

  suite("subscribe to test status", () => {
    test("listen status changes", () => {
      const statusHistory: string[] = []

      const testItem3 = testItemFactory({
        id: "3",
        items: []
      })
      const testItem4 = testItemFactory({
        id: "4",
        items: []
      })
      const mainTest = testItemFactory({
        id: "1",
        items: [
          testItemFactory({
            id: "2",
            items: [testItem3]
          }),
          testItem4
        ]
      })

      mainTest.on("status", test => statusHistory.push(test.id))

      testItem3.status = "passed"
      testItem4.status = "passed"

      assert.deepEqual(statusHistory, ["3", "2", "1", "4", "1"])
    })

    test("merge status", () => {
      const statusHistory: Array<{ status: TestStatus, id: string }> = []
      const test3 = testItemFactory({ id: "3", })
      const test4 = testItemFactory({ id: "4" })
      const test5 = testItemFactory({ id: "5" })
      const mainTest = testItemFactory({
        id: "1",
        items: [
          testItemFactory({
            id: "2",
            items: [test3, test4]
          }),
          test5
        ]
      })

      mainTest.on("status", ({ id, status }) => statusHistory.push({ id, status }))

      test3.status = "queued"
      test4.status = "queued"
      test5.status = "queued"

      test3.status = "started"
      test3.status = "passed"

      test4.status = "started"
      test4.status = "failed"

      test5.status = "started"
      test5.status = "errored"

      const expectedHistory: typeof statusHistory = [
        { id: "3", status: "queued" },
        { id: "2", status: "queued" },
        { id: "1", status: "queued" },
        { id: "4", status: "queued" },
        { id: "2", status: "queued" },
        { id: "1", status: "queued" },
        { id: "5", status: "queued" },
        { id: "1", status: "queued" },

        { id: "3", status: "started" },
        { id: "2", status: "started" },
        { id: "1", status: "started" },
        { id: "3", status: "passed" },
        { id: "2", status: "queued" },
        { id: "1", status: "queued" },

        { id: "4", status: "started" },
        { id: "2", status: "started" },
        { id: "1", status: "started" },
        { id: "4", status: "failed" },
        { id: "2", status: "failed" },
        { id: "1", status: "queued" },

        { id: "5", status: "started" },
        { id: "1", status: "started" },
        { id: "5", status: "errored" },
        { id: "1", status: "failed" },
      ]

      assert.deepEqual(statusHistory, expectedHistory)
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

function testItemFactory ({ id, items = [] }: { id: string, items?: TestItem[] }) {
  return new TestItem({
    id,
    items,
    name: "1",
    basePath: "fake/path",
    phase: "fake",
    run
  })
}
