import simpleGit, { SimpleGit } from "simple-git"
import { OutputChannel } from "./types"

export async function clonePintosSnapshot({ localPath, outputChannel, repoPath, codeFolder }: CloneContext) {
  const git = simpleGit({
    config: ["core.autocrlf=input"],
    progress ({ method, progress, stage, processed, total }) {
      outputChannel.appendLine(`git.${method} ${stage} stage ${progress}% complete ${processed}/${total}`)
    }
  })

  const usePartialClone = codeFolder && await supportPartialClone(git)

  if (usePartialClone) {
    outputChannel.appendLine("use partial clone mode")
    await git.clone(repoPath, localPath, ["--progress", "--sparse", "--filter=blob:none", "--depth=1"])
      .cwd({ path: localPath, root: true })
      .raw("sparse-checkout", "add", codeFolder)
  } else {
    await git.clone(repoPath, localPath, ["--progress"])
  }
}

async function supportPartialClone(git: SimpleGit): Promise<boolean> {
  const version = await git.version()

  return version.major >= 2 && version.minor >= 27
}

export interface CloneContext extends CreationContext {
  repoPath: string,
  localPath: string
  codeFolder?: string | null
}

export interface CreationContext {
  outputChannel: OutputChannel
}

export const initialEditorConfig = `# EditorConfig is awesome: https://EditorConfig.org

# top-most EditorConfig file
root = true

[*]
indent_style = space
indent_size = 4
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
\n`

export const initialGitAttributes = `# Don't normalize
* -text
\n`
