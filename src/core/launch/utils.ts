export function buildSingleCommand(commands: string[], { separator = "\n" }: {
  separator?: "\n" | "&&"
} = { }) {
  return commands.join(separator)
}
