import { describe, expect, it } from "vitest";
import { buildSnippets } from "../badgeSnippets";

describe("badge snippets", () => {
  it("builds badge snippets with the image URL and referral link", () => {
    const snippets = buildSnippets("AbCdEfGhJkLm", "https://api.example", "https://dash.example");
    const imageUrl = "https://api.example/badge/AbCdEfGhJkLm.svg";
    const referralUrl = "https://dash.example/?ref=badge&p=AbCdEfGhJkLm";

    expect(snippets.html).toContain(imageUrl);
    expect(snippets.markdown).toContain(imageUrl);
    expect(snippets.react).toContain(imageUrl);
    expect(snippets.html).toContain(referralUrl);
    expect(snippets.markdown).toContain(referralUrl);
    expect(snippets.react).toContain(referralUrl);
    expect(snippets.markdown.startsWith("[![")).toBe(true);
    expect(snippets.react).toContain("height={30}");
  });
});
