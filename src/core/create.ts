import simpleGit, { SimpleGit } from "simple-git"
import { OptionalPromiseLike, OutputChannel } from "./types"
import { conditionalExecute } from "./utils"

const defaultEditorConfig = `# EditorConfig is awesome: https://EditorConfig.org

# top-most EditorConfig file
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
`

const defaultGitAttributes = `# Don't normalize
* -text
`

export async function clonePintosSnapshot({ localPath, outputChannel, repoUrl, codeFolder }: {
  repoUrl: string
  localPath: string
  codeFolder?: string | null
  outputChannel: OutputChannel
}) {
  const git = simpleGit({
    config: ["core.autocrlf=input"],
    progress ({ method, progress, stage, processed, total }) {
      outputChannel.appendLine(`git.${method} ${stage} stage ${progress}% complete ${processed}/${total}`)
    }
  })

  const usePartialClone = codeFolder && await supportPartialClone(git)

  if (usePartialClone) {
    outputChannel.appendLine("use partial clone mode")
    await git.clone(repoUrl, localPath, ["--progress", "--sparse", "--filter=blob:none", "--depth=1"])
      .cwd({ path: localPath, root: true })
      .raw("sparse-checkout", "add", codeFolder)
  } else {
    await git.clone(repoUrl, localPath, ["--progress"])
  }
}

async function supportPartialClone(git: SimpleGit): Promise<boolean> {
  const version = await git.version()

  return version.major >= 2 && version.minor >= 27
}

export async function initPintosProject({ output, pintosPath, exists, removeGitDir, writeFile }: {
  /** the snapshot must not contain a git repo */
  removeGitDir: (gitDirName: string) => OptionalPromiseLike<void>
  exists: (filename: string) => OptionalPromiseLike<boolean>
  writeFile: (filename: string, content: string) => OptionalPromiseLike<void>
  gitRemote: string
  pintosPath: string
  output: OutputChannel
}) {
  const git = simpleGit({ config: ["init.defaultbranch=pepito"] })
  git.cwd({ path: pintosPath, root: true })
  git.outputHandler(gitOutputHandler(output))

  const gitDir = ".git"
  if (exists(gitDir)) {
    await removeGitDir(gitDir)
  }

  const gitAttributesFile = ".gitattributes"
  await conditionalExecute({
    condition: !await exists(gitAttributesFile),
    execute: writeFile.bind(null, gitAttributesFile, defaultGitAttributes)
  })

  const editorConfigFile = ".editorconfig"
  await conditionalExecute({
    condition: !await exists(editorConfigFile),
    execute: writeFile.bind(null, editorConfigFile, defaultEditorConfig)
  })

  await git.init()
}

function gitOutputHandler(output: OutputChannel) {
  return (_cmd: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream) => {
    stdout.on("data", (buffer) => output.append(buffer.toString()))
    stderr.on("data", (buffer) => output.append(buffer.toString()))
  }
}
