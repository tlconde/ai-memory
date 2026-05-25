/** Raised when a projection source fails to load documents (operator-facing message). */
export class ProjectionSourceLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionSourceLoadError";
  }
}
