import { describe, it, expect, vi, beforeEach } from "vitest";
import { Questions } from "../../src/modules/questions.js";
import type { HttpClient } from "../../src/http.js";
import type { AgentSubmitMarketDraft } from "../../src/types.js";

function createMockHttp(): HttpClient {
  return {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
}

describe("Questions module", () => {
  let http: ReturnType<typeof createMockHttp>;
  let questions: Questions;

  beforeEach(() => {
    http = createMockHttp();
    questions = new Questions(http);
  });

  it("submit() calls POST /questions with question string", async () => {
    (http.post as any).mockResolvedValue({ submissionId: "sub_1" });

    const result = await questions.submit("Will BTC hit 100k?");

    expect(http.post).toHaveBeenCalledWith("/questions", {
      question: "Will BTC hit 100k?",
    });
    expect(result).toEqual({ submissionId: "sub_1" });
  });

  it("getSubmission() calls GET /questions/submissions/:id", async () => {
    (http.get as any).mockResolvedValue({
      submissionId: "sub_1",
      status: "completed",
    });

    const result = await questions.getSubmission("sub_1");

    expect(http.get).toHaveBeenCalledWith("/questions/submissions/sub_1");
    expect(result.status).toBe("completed");
  });

  it("agentSubmit() calls POST /questions/agent-submit with draft", async () => {
    const draft: AgentSubmitMarketDraft = {
      market: {
        formattedQuestion: "Will BTC exceed $100,000 by end of 2026?",
        shortQuestion: "BTC > $100k by 2026?",
        marketType: "OBJECTIVE",
        evidenceMode: "web_enabled",
        resolutionCriteria: "Resolves YES if BTC price exceeds $100,000 on any major exchange.",
        endTime: "2026-12-31 23:59:59",
        sources: ["coingecko.com"],
      },
    };

    (http.post as any).mockResolvedValue({ submissionId: "sub_agent_1" });

    const result = await questions.agentSubmit(draft);

    expect(http.post).toHaveBeenCalledWith(
      "/questions/agent-submit",
      draft,
    );
    expect(result).toEqual({ submissionId: "sub_agent_1" });
  });

  it("agentSubmitAndWait() polls until completed", async () => {
    const draft: AgentSubmitMarketDraft = {
      market: {
        formattedQuestion: "Test question?",
        shortQuestion: "Test?",
        marketType: "SUBJECTIVE",
        evidenceMode: "social_only",
        resolutionCriteria: "Resolves based on consensus.",
        endTime: "2026-06-01 12:00:00",
      },
    };

    (http.post as any).mockResolvedValue({ submissionId: "sub_poll" });
    (http.get as any)
      .mockResolvedValueOnce({ submissionId: "sub_poll", status: "processing" })
      .mockResolvedValueOnce({ submissionId: "sub_poll", status: "completed", questions: [] });

    const result = await questions.agentSubmitAndWait(draft, {
      pollIntervalMs: 10,
      maxAttempts: 5,
    });

    expect(http.post).toHaveBeenCalledWith("/questions/agent-submit", draft);
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("completed");
  });

  it("agentSubmitAndWait() throws on failure", async () => {
    const draft: AgentSubmitMarketDraft = {
      market: {
        formattedQuestion: "Bad question?",
        shortQuestion: "Bad?",
        marketType: "SUBJECTIVE",
        evidenceMode: "social_only",
        resolutionCriteria: "N/A",
        endTime: "2026-06-01 12:00:00",
      },
    };

    (http.post as any).mockResolvedValue({ submissionId: "sub_fail" });
    (http.get as any).mockResolvedValue({ submissionId: "sub_fail", status: "failed" });

    await expect(
      questions.agentSubmitAndWait(draft, { pollIntervalMs: 10, maxAttempts: 3 }),
    ).rejects.toThrow("Agent submission sub_fail failed");
  });

  it("submitAndWait() polls until completed", async () => {
    (http.post as any).mockResolvedValue({ submissionId: "sub_2" });
    (http.get as any)
      .mockResolvedValueOnce({ submissionId: "sub_2", status: "pending" })
      .mockResolvedValueOnce({ submissionId: "sub_2", status: "completed", questions: [] });

    const result = await questions.submitAndWait("Will it rain?", {
      pollIntervalMs: 10,
      maxAttempts: 5,
    });

    expect(result.status).toBe("completed");
  });

  it("submitAndWait() throws on timeout", async () => {
    (http.post as any).mockResolvedValue({ submissionId: "sub_3" });
    (http.get as any).mockResolvedValue({ submissionId: "sub_3", status: "processing" });

    await expect(
      questions.submitAndWait("Slow question?", { pollIntervalMs: 10, maxAttempts: 2 }),
    ).rejects.toThrow("did not complete within 2 attempts");
  });
});
