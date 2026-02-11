export class ContextApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: string }).message)
        : `API request failed with status ${status}`;
    super(message);
    this.name = "ContextApiError";
    this.status = status;
    this.body = body;
  }
}

export class ContextSigningError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ContextSigningError";
    if (cause) this.cause = cause;
  }
}

export class ContextConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextConfigError";
  }
}
