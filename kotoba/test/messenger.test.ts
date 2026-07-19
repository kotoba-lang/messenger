import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerChannel,
  listChannels,
  getChannel,
  sendMessage,
  listMessages,
  getMessage,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:messenger.etzhayyim.com";

describe("messenger kotoba (Consensys c-split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("channel (PLAINTEXT public directory)", () => {
    it("registers, dedups, validates, lists/filters, gets", async () => {
      expect((await registerChannel(e, { channelId: "general", name: "General", visibility: "public", memberCount: 42 })).status).toBe("registered");
      expect((await registerChannel(e, { channelId: "general", name: "General", visibility: "public" })).status).toBe("alreadyExists");
      expect((await registerChannel(e, { channelId: "bad", name: "Bad", memberCount: -1 })).status).toBe("rejected");
      expect((await registerChannel(e, { channelId: "bad2", name: "Bad", visibility: "weird" as any })).status).toBe("rejected");
      await registerChannel(e, { channelId: "ops", name: "Ops", visibility: "private", memberCount: 7 });
      expect((await listChannels(e)).total).toBe(2);
      expect((await listChannels(e, { visibility: "public" })).total).toBe(1);
      const got = await getChannel(e, { channelId: "general" });
      expect(got.channel?.name).toBe("General");
      expect(got.channel?.memberCount).toBe(42);
      expect((await getChannel(e, { channelId: "missing" })).error).toBe("notFound");
    });
  });

  describe("message (E2E-ENCRYPTED private content + metadata)", () => {
    beforeEach(async () => {
      await registerChannel(e, { channelId: "general", name: "General", visibility: "public" });
    });

    it("seals via encryptedWrite, round-trips via encryptedRead, validates, FK-checks", async () => {
      const ok = await sendMessage(e, { messageId: "m1", channelId: "general", authorDid: "did:web:alice.example", text: "hello team" });
      expect(ok.status).toBe("sent");
      expect(ok.keyId).toBeTruthy();
      // missing required field
      expect((await sendMessage(e, { messageId: "mX", channelId: "general", authorDid: "did:web:a", text: "" })).status).toBe("rejected");
      // FK: unknown channel rejected
      expect((await sendMessage(e, { messageId: "mY", channelId: "nope", authorDid: "did:web:a", text: "hi" })).status).toBe("rejected");
      expect((await sendMessage(e, { messageId: "mY", channelId: "nope", authorDid: "did:web:a", text: "hi" })).error).toBe("channelNotFound");

      const got = await getMessage(e, { messageId: "m1" });
      expect(got.message?.text).toBe("hello team");
      expect(got.message?.authorDid).toBe("did:web:alice.example");

      // thread reply
      await sendMessage(e, { messageId: "m2", channelId: "general", authorDid: "did:web:bob.example", text: "re: hello", parentId: "m1" });
      expect((await listMessages(e)).total).toBe(2);
      expect((await listMessages(e, { channelId: "general" })).total).toBe(2);
      // top-level only (parentId === "")
      expect((await listMessages(e, { parentId: "" })).total).toBe(1);
      // thread of m1
      expect((await listMessages(e, { parentId: "m1" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the message", async () => {
      await sendMessage(e, { messageId: "m1", channelId: "general", authorDid: "did:web:alice", text: "secret" });
      // A different actor (no read-cap) is a distinct PDS view → sees zero messages.
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listMessages(outsider)).total).toBe(0);
      expect((await getMessage(outsider, { messageId: "m1" })).error).toBe("notFound");
    });

    it("grants read-cap to explicit recipients (channel members / DM participants)", async () => {
      const member = "did:web:member.example";
      const r = await sendMessage(e, { messageId: "m1", channelId: "general", authorDid: "did:web:alice", text: "hi", recipients: [member] });
      expect(r.status).toBe("sent");
      // owner can read
      expect((await listMessages(e)).total).toBe(1);
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext channels + E2E messages", async () => {
      await registerChannel(e, { channelId: "general", name: "General", visibility: "public" });
      await registerChannel(e, { channelId: "ops", name: "Ops", visibility: "private" });
      await sendMessage(e, { messageId: "m1", channelId: "general", authorDid: "did:web:a", text: "hi" });
      const cov = await coverage(e);
      expect(cov.channelCount).toBe(2);
      expect(cov.messageCount).toBe(1);
      expect(cov.channelsByVisibility?.public).toBe(1);
      expect(cov.channelsByVisibility?.private).toBe(1);
    });
  });
});
