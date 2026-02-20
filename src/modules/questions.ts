import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import type {
  SubmitQuestionResult,
  QuestionSubmission,
  SubmitAndWaitOptions,
} from "../types.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_ATTEMPTS = 45;

export class Questions {
  constructor(private readonly http: HttpClient) {}

  async submit(question: string): Promise<SubmitQuestionResult> {
    return this.http.post<SubmitQuestionResult>(ENDPOINTS.questions.submit, {
      question,
    });
  }

  async getSubmission(submissionId: string): Promise<QuestionSubmission> {
    return this.http.get<QuestionSubmission>(
      ENDPOINTS.questions.submission(submissionId),
    );
  }

  async submitAndWait(
    question: string,
    options?: SubmitAndWaitOptions,
  ): Promise<QuestionSubmission> {
    const pollIntervalMs =
      options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    const { submissionId } = await this.submit(question);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const submission = await this.getSubmission(submissionId);

      if (submission.status === "completed") {
        return submission;
      }

      if (submission.status === "failed") {
        throw new Error(
          `Question submission ${submissionId} failed`,
        );
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new Error(
      `Question submission ${submissionId} did not complete within ${maxAttempts} attempts`,
    );
  }
}
