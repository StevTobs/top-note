import { describe, it, expect, vi, afterEach } from "vitest";
import { descendants, safeUrl } from "../../src/model";
import { endpoint, listModels, summarize } from "../../src/ai";
import { validateDocument } from "../../src/backup";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { captureScope } from "../../src/editor/scope";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

afterEach(() => vi.restoreAllMocks());
describe("AI boundary", () => {
  it("sends only supplied selection, never retries automatically", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "สรุป" } }] }),
        ),
      );
    expect(
      await summarize(
        {
          name: "test",
          baseUrl: "https://example.com/v1",
          model: "test-model",
        },
        "secret",
        "Only this section",
        { format: "bullet", length: "short", language: "Thai" },
        new AbortController().signal,
      ),
    ).toBe("สรุป");
    const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "Only this section",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects empty and oversized scopes before network", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    for (const text of ["", "a".repeat(24001)])
      await expect(
        summarize(
          { name: "test", baseUrl: "https://example.com/v1", model: "x" },
          "",
          text,
          { format: "bullet", length: "short", language: "Thai" },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("dispatches Claude connections to the Anthropic Messages API", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "สรุป claude" }] }),
        ),
      );
    const result = await summarize(
      {
        name: "claude",
        providerType: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-5",
      },
      "secret",
      "Only this section",
      { format: "bullet", length: "short", language: "Thai" },
      new AbortController().signal,
    );
    expect(result).toBe("สรุป claude");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe(
      "secret",
    );
    const body = JSON.parse(init?.body as string);
    expect(body.messages).toEqual([
      { role: "user", content: "Only this section" },
    ]);
  });
  it("lists models from an OpenAI-compatible /models endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-4o" }] })),
    );
    const list = await listModels(
      { name: "x", providerType: "openai", baseUrl: "https://api.openai.com/v1", model: "" },
      "secret",
      new AbortController().signal,
    );
    expect(list).toEqual(["gpt-4o", "gpt-5"]);
  });
  it("lists models from Anthropic's /v1/models endpoint", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5" }] })),
    );
    const list = await listModels(
      {
        name: "x",
        providerType: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "",
      },
      "secret",
      new AbortController().signal,
    );
    expect(fetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models");
    expect(list).toEqual(["claude-sonnet-5"]);
  });
  it("normalizes endpoint and blocks credential URLs", () => {
    expect(endpoint("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1/chat/completions",
    );
    expect(endpoint("https://example.com/v1/chat/completions")).toBe(
      "https://example.com/v1/chat/completions",
    );
    expect(() => endpoint("https://user:pass@example.com")).toThrow();
    expect(() => endpoint("http://example.com/v1")).toThrow();
  });
  it("H2 includes child H3 and stops before next H2", () => {
    const schema = getSchema([StarterKit]);
    const h = (level: number, text: string) =>
      schema.nodes.heading.create({ level }, schema.text(text));
    const p = (text: string) =>
      schema.nodes.paragraph.create(null, schema.text(text));
    const doc = schema.nodes.doc.create(null, [
      h(1, "Title"),
      h(2, "A"),
      p("selected"),
      h(3, "child"),
      p("child text"),
      h(2, "B"),
      p("secret outside"),
    ]);
    let pos = 0;
    doc.forEach((n, p) => {
      if (n.textContent === "A") pos = p;
    });
    const editor = {
      state: { doc, selection: TextSelection.create(doc, pos + 1) },
    } as Editor;
    const scope = captureScope(editor, "section");
    expect(scope.text).toContain("child text");
    expect(scope.text).not.toContain("secret outside");
    expect(scope.text).not.toContain("Title");
    expect(scope.replaceFrom).toBe(pos + doc.nodeAt(pos)!.nodeSize);
  });
});
describe("untrusted imported documents", () => {
  it("drops unsafe links and rejects unsupported nodes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe(false);
    const cleaned = validateDocument({
      type: "text",
      text: "Click",
      marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
    });
    expect(cleaned.marks).toEqual([]);
    expect(() => validateDocument({ type: "script" })).toThrow();
  });
});
describe("category tree", () => {
  it("collects nested descendants and tolerates cycles", () => {
    const c = (id: string, parentId: string | null) => ({
      id,
      parentId,
      name: id,
      order: 0,
      deletedAt: null,
    });
    expect(descendants([c("a", null), c("b", "a"), c("c", "b")], "a")).toEqual(
      new Set(["a", "b", "c"]),
    );
    expect(descendants([c("a", "b"), c("b", "a")], "a")).toEqual(
      new Set(["a", "b"]),
    );
  });
});
