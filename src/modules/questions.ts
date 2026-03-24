import type { HttpClient } from "../http.js";
import { ENDPOINTS } from "../endpoints.js";
import { ContextApiError } from "../errors.js";
import type {
  SubmitQuestionResult,
  QuestionSubmission,
  SubmitAndWaitOptions,
  AgentSubmitMarketDraft,
} from "../types.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_ATTEMPTS = 45;

export class Questions {
  constructor(private readonly http: HttpClient) {}

  private async pollSubmission(
    submissionId: string,
    label: string,
    options?: SubmitAndWaitOptions,
  ): Promise<QuestionSubmission> {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const pollIntervalMs =
      options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const submission = await this.getSubmission(submissionId);

      if (submission.status === "completed") {
        return submission;
      }

      if (submission.status === "failed") {
        throw new ContextApiError(422, {
          message: `${label} ${submissionId} failed`,
          submission,
        });
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    throw new ContextApiError(408, {
      message: `${label} polling timed out after ${maxAttempts} attempts`,
      submissionId,
    });
  }

  async submit(question: string): Promise<SubmitQuestionResult> {
    return this.http.post<SubmitQuestionResult>(ENDPOINTS.questions.submit, {
      question,
    });
  }

  async agentSubmit(draft: AgentSubmitMarketDraft): Promise<SubmitQuestionResult> {
    return this.http.post<SubmitQuestionResult>(
      ENDPOINTS.questions.agentSubmit,
      draft,
    );
  }

  async agentSubmitAndWait(
    draft: AgentSubmitMarketDraft,
    options?: SubmitAndWaitOptions,
  ): Promise<QuestionSubmission> {
    const { submissionId } = await this.agentSubmit(draft);
    return this.pollSubmission(submissionId, "Agent submission", options);
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
    const { submissionId } = await this.submit(question);
    return this.pollSubmission(submissionId, "Question submission", options);
  }
}
