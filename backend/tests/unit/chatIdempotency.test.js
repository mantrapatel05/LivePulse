jest.mock("../../src/models/ChatMessage");

const ChatMessage = require("../../src/models/ChatMessage");
const { __test } = require("../../src/sockets/socketHandler");

const { saveChatOnce, cleanText } = __test;

describe("chat idempotency helpers", () => {
  beforeEach(() => {
    ChatMessage.create.mockReset();
    ChatMessage.findOne.mockReset();
  });

  it("returns duplicate false for a first save", async () => {
    const doc = { _id: "m1", createdAt: new Date() };
    ChatMessage.create.mockResolvedValue(doc);

    const result = await saveChatOnce({
      projectId: "p1",
      sessionId: "s1",
      sender: "user",
      message: "hello",
      clientMsgId: "client-msg-123",
    });

    expect(result).toEqual({ doc, duplicate: false });
  });

  it("returns the existing document after a duplicate-key error", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
    const doc = { _id: "m1" };
    ChatMessage.create.mockRejectedValue(duplicateError);
    ChatMessage.findOne.mockResolvedValue(doc);

    const result = await saveChatOnce({
      projectId: "p1",
      sessionId: "s1",
      sender: "user",
      message: "hello",
      clientMsgId: "client-msg-123",
    });

    expect(result).toEqual({ doc, duplicate: true });
    expect(ChatMessage.findOne).toHaveBeenCalledWith({
      projectId: "p1",
      sessionId: "s1",
      sender: "user",
      clientMsgId: "client-msg-123",
    });
  });

  it("rethrows duplicate-key errors without a valid client message id", async () => {
    const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
    ChatMessage.create.mockRejectedValue(duplicateError);

    await expect(
      saveChatOnce({ projectId: "p1", sessionId: "s1", sender: "user", message: "hello", clientMsgId: "x" }),
    ).rejects.toBe(duplicateError);
    expect(ChatMessage.findOne).not.toHaveBeenCalled();
  });

  it("does not store an invalid client message id", async () => {
    ChatMessage.create.mockResolvedValue({ _id: "m1" });

    await saveChatOnce({
      projectId: "p1",
      sessionId: "s1",
      sender: "user",
      message: "hello",
      clientMsgId: "x",
    });

    expect(ChatMessage.create).toHaveBeenCalledWith({
      projectId: "p1",
      sessionId: "s1",
      sender: "user",
      message: "hello",
    });
  });

  it("trims, rejects empty text, and caps the message length", () => {
    expect(() => cleanText("   ")).toThrow("Message is empty");
    expect(cleanText("a".repeat(5000))).toHaveLength(2000);
  });
});
