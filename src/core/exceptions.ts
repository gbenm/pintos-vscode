export class GitAuthorUnknownError extends Error {
  constructor() {
    super("Author identity unknown")
  }
}
