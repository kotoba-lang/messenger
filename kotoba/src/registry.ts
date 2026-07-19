/**
 * messenger kotoba — registry.
 *
 * Plaintext path (channel): sdk.write / sdk.read — public channel directory.
 * E2E path (message): sdk.encryptedWrite / sdk.encryptedRead — message bodies
 * (content + metadata) sealed in the kotoba envelope (ADR-2605181100), read-cap
 * = owner DID + explicit recipients (channel members / DM participants). The
 * substrate never sees message plaintext.
 *
 * FK message → channel via channelExists() (read + check; mock has no exists()).
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  CHANNEL_COLLECTION,
  MESSAGE_INNER_TYPE,
  channelDidFor,
  channelRkey,
  isUint,
  isVisibility,
  messageRkey,
  type ChannelRecord,
  type ChannelView,
  type CoverageInput,
  type CoverageOutput,
  type GetChannelInput,
  type GetChannelOutput,
  type GetMessageInput,
  type GetMessageOutput,
  type ListChannelsInput,
  type ListChannelsOutput,
  type ListMessagesInput,
  type ListMessagesOutput,
  type MessageBody,
  type MessageView,
  type RegisterChannelInput,
  type RegisterChannelOutput,
  type SendMessageInput,
  type SendMessageOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function channelExists(e: Etzhayyim, channelId: string): Promise<boolean> {
  const rkey = channelRkey(channelId);
  const resp = await e
    .read<ChannelRecord>({ collection: CHANNEL_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: ChannelRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── Channel directory (PLAINTEXT) ──────────────────────────────────

export async function registerChannel(e: Etzhayyim, input: RegisterChannelInput): Promise<RegisterChannelOutput> {
  if (!input.channelId || !input.name) return { status: "rejected", error: "missingRequiredFields" };
  if (input.visibility !== undefined && !isVisibility(input.visibility)) return { status: "rejected", error: "invalidVisibility" };
  if (input.memberCount !== undefined && !isUint(input.memberCount)) return { status: "rejected", error: "invalidMemberCount" };
  const rkey = channelRkey(input.channelId);
  const existing = await e.read<ChannelRecord>({ collection: CHANNEL_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", channelUri: existing.records[0].uri, did: existing.records[0].value.did, channelId: input.channelId };
  }
  const now = new Date().toISOString();
  const did = channelDidFor(input.channelId);
  const record: ChannelRecord = {
    did,
    channelId: input.channelId,
    name: input.name,
    topic: input.topic ?? "",
    purpose: input.purpose ?? "",
    visibility: input.visibility ?? "public",
    memberCount: input.memberCount ?? 0,
    createdAt: now,
  };
  const receipt = await e.write({ collection: CHANNEL_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", channelUri: receipt.uri, did, channelId: input.channelId };
}

export async function listChannels(e: Etzhayyim, input: ListChannelsInput = {}): Promise<ListChannelsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ChannelRecord>({ collection: CHANNEL_COLLECTION, cursor: input.cursor, limit });
  const items: ChannelView[] = resp.records
    .filter((r) => !input.visibility || r.value.visibility === input.visibility)
    .map((r) => ({ ...r.value, channelUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

export async function getChannel(e: Etzhayyim, input: GetChannelInput): Promise<GetChannelOutput> {
  if (!input.channelId) return { error: "invalidChannelId" };
  const rkey = channelRkey(input.channelId);
  const resp = await e
    .read<ChannelRecord>({ collection: CHANNEL_COLLECTION, rkey })
    .catch(() => ({ records: [] }));
  const hit = resp.records[0];
  if (!hit?.value) return { error: "notFound" };
  return { channel: { ...hit.value, channelUri: hit.uri } };
}

// ─── Message (E2E-ENCRYPTED, private content + metadata) ─────────────

export async function sendMessage(e: Etzhayyim, input: SendMessageInput): Promise<SendMessageOutput> {
  if (!input.messageId || !input.channelId || !input.authorDid || !input.text) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  // FK: message must reference a known channel.
  if (!(await channelExists(e, input.channelId))) return { status: "rejected", error: "channelNotFound" };
  const body: MessageBody = {
    messageId: input.messageId,
    channelId: input.channelId,
    authorDid: input.authorDid,
    parentId: input.parentId ?? "",
    text: input.text,
    sentAt: input.sentAt ?? new Date().toISOString(),
  };
  // Read-cap = owner DID (sender, auto-wrapped) + explicit recipients
  // (channel members / DM participants).
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: MESSAGE_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: messageRkey(input.messageId),
  });
  return { status: "sent", uri: receipt.uri, keyId: receipt.keyId, messageId: input.messageId };
}

async function scanMessages(e: Etzhayyim, maxScan: number): Promise<MessageView[]> {
  const out: MessageView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<MessageBody>({ innerType: MESSAGE_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    }
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listMessages(e: Etzhayyim, input: ListMessagesInput = {}): Promise<ListMessagesOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanMessages(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter(
    (m) =>
      (!input.channelId || m.channelId === input.channelId) &&
      (input.parentId === undefined || m.parentId === input.parentId),
  );
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getMessage(e: Etzhayyim, input: GetMessageInput): Promise<GetMessageOutput> {
  if (!input.messageId) return { error: "invalidMessageId" };
  const all = await scanMessages(e, DEFAULT_MAX_SCAN);
  const found = all.find((m) => m.messageId === input.messageId);
  if (!found) return { error: "notFound" };
  return { message: found };
}

// ─── Coverage rollup ────────────────────────────────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const channelsByVisibility: Record<string, number> = {};
  let channelCount = 0;
  let cursor: string | undefined;
  while (channelCount < maxScan) {
    const page = await e.read<ChannelRecord>({ collection: CHANNEL_COLLECTION, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      channelsByVisibility[r.value.visibility] = (channelsByVisibility[r.value.visibility] ?? 0) + 1;
      channelCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    cursor = page.cursor;
  }
  const messageCount = (await scanMessages(e, maxScan)).length;
  return {
    channelCount,
    messageCount,
    channelsByVisibility,
    truncated: channelCount >= maxScan || messageCount >= maxScan,
  };
}
