import simpleGit, { SimpleGit, SimpleGitProgressEvent } from "simple-git"
import { GitAuthorUnknownError } from "./exceptions"
import { OptionalPromiseLike, OutputChannel } from "./types"
import { conditionalExecute } from "./utils"

const defaultEditorConfig = `# EditorConfig is awesome: https://EditorConfig.org

# top-most EditorConfig file
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
`

const defaultGitAttributes = `# Always use LF line endings for text files
* text=auto eol=lf
`

export async function clonePintosSnapshot({ localPath, outputChannel, repoUrl, codeFolder, abort, progressHandler }: {
  repoUrl: string
  localPath: string
  codeFolder?: string | null
  outputChannel: OutputChannel
  abort?: AbortSignal
  progressHandler?: (data: SimpleGitProgressEvent) => void
}) {
  const git = simpleGit({
    config: ["core.autocrlf=false"],
    abort,
    progress (data) {
      const { method, progress, stage, processed, total } = data
      outputChannel.appendLine(`git.${method} ${stage} stage ${progress}% complete ${processed}/${total}`)
      progressHandler?.(data)
    }
  })

  const usePartialClone = codeFolder && await supportPartialClone(git)

  if (usePartialClone) {
    outputChannel.appendLine("use partial clone mode")
    await git.clone(repoUrl, localPath, ["--progress", "--sparse", "--filter=blob:none", "--depth=1"])
      .cwd({ path: localPath, root: true })
      .raw("sparse-checkout", "add", codeFolder)
  } else {
    await git.clone(repoUrl, localPath, ["--progress", "--depth=1"])
  }
}

async function supportPartialClone(git: SimpleGit): Promise<boolean> {
  const version = await git.version()

  return version.major >= 2 && version.minor >= 27
}

export async function initPintosProject({ output, pintosPath, exists, removeGitDir, writeFile, gitRemote }: {
  /** the snapshot must not contain a git repo */
  removeGitDir: (gitDirName: string) => OptionalPromiseLike<void>
  exists: (filename: string) => OptionalPromiseLike<boolean>
  writeFile: (filename: string, content: string) => OptionalPromiseLike<void>
  gitRemote: string
  pintosPath: string
  output: OutputChannel
}) {
  const git = simpleGit({ config: ["init.defaultbranch=main"] })
  git.cwd({ path: pintosPath, root: true })
  git.outputHandler(gitOutputHandler(output))

  const gitDir = ".git"
  if (await exists(gitDir)) {
    await removeGitDir(gitDir)
  }

  const gitAttributesFile = ".gitattributes"
  await conditionalExecute({
    condition: !await exists(gitAttributesFile),
    async execute () {
      await writeFile(gitAttributesFile, defaultGitAttributes)
      output.appendLine(`${gitAttributesFile} created successfully`)
    }
  })

  const editorConfigFile = ".editorconfig"
  await conditionalExecute({
    condition: !await exists(editorConfigFile),
    async execute () {
      await writeFile(editorConfigFile, defaultEditorConfig)
      output.appendLine(`${editorConfigFile} created successfully`)
    }
  })

  await git.init()
    .addRemote("origin", gitRemote)
    .add(".")

  await failIfTheAuthorIsUnknown(git)

  await git.commit("feat: first commit")
}

async function failIfTheAuthorIsUnknown(git: SimpleGit) {
  const nameConfig = await git.getConfig("user.name")
  const emailConfig = await git.getConfig("user.email")

  const name = nameConfig.value
  const email = emailConfig.value

  if (!name || !email) {
    throw new GitAuthorUnknownError()
  }
}

function gitOutputHandler(output: OutputChannel) {
  return (_cmd: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream) => {
    stdout.on("data", (buffer) => output.append(buffer.toString()))
    stderr.on("data", (buffer) => output.append(buffer.toString()))
  }
}
