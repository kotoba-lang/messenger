/**
 * messenger kotoba — real-time messaging platform (channels, DMs, thread
 * replies) under the Consensys product-front / etzhayyim-infra-back split.
 *
 * Per ADR-2606011400 (Consensys product-front) + ADR-2605172400 (3-axis) +
 * ADR-2605181100 (kotoba E2E encrypted-record envelope). Founder directive
 * 2026-06-03: front everything that can move; only the irreducible regulated
 * EXECUTION stays etzhayyim.
 *
 * SPLIT (maximal migration):
 *   PLAINTEXT (public AT records) — channel directory: non-sensitive channel
 *   catalog/metadata (name, topic, purpose, visibility, memberCount). A public
 *   read-view of the workspace's channels. Frontable open metadata.
 *
 *   E2E (kotoba, com.etzhayyim.encrypted.record) — message bodies: private
 *   content + message-metadata (author DID, channel, thread parent, text)
 *   sealed via sdk.encryptedWrite. Read-cap = owner DID + explicit recipients
 *   (channel members / DM participants). Channel messages, direct messages and
 *   thread replies are ALL E2E — the substrate never sees plaintext message
 *   content. FK message → channel via channelExists() (read + check).
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection):
 *     - real-time fan-out / live-delivery EXECUTION (the push/socket gateway —
 *       high-volume live delivery transport that cannot be a PDS record append),
 *     - abuse/spam enforcement + blocking ACTIONS (moderation acts).
 *   The message DATA (content, metadata, history, threads, DMs) all fronts E2E;
 *   only the live-delivery execution + enforcement actions stay etzhayyim.
 *
 * AT-Lexicon: no float (memberCount is a non-negative integer).
 */

// Plaintext public collection.
export const CHANNEL_COLLECTION = "com.etzhayyim.apps.messenger.channel";
// E2E inner-type NSID (body shape inside the encrypted envelope).
export const MESSAGE_INNER_TYPE = "com.etzhayyim.apps.messenger.message";

export const MESSENGER_DID_PREFIX = "did:web:messenger.etzhayyim.com:" as const;

export type ChannelVisibility = "public" | "private" | "dm";
const VISIBILITIES: readonly ChannelVisibility[] = ["public", "private", "dm"];

// ─── Channel (PLAINTEXT, public directory) ──────────────────────────

export interface ChannelRecord {
  did: string;
  channelId: string;
  name: string;
  topic: string;
  purpose: string;
  visibility: ChannelVisibility;
  memberCount: number;
  createdAt: string;
}
export interface ChannelView extends ChannelRecord {
  channelUri: string;
}
export interface RegisterChannelInput {
  channelId: string;
  name: string;
  topic?: string;
  purpose?: string;
  visibility?: ChannelVisibility;
  memberCount?: number;
}
export interface RegisterChannelOutput {
  status: "registered" | "alreadyExists" | "rejected";
  channelUri?: string;
  did?: string;
  channelId?: string;
  error?: string;
}
export interface ListChannelsInput {
  visibility?: ChannelVisibility;
  limit?: number;
  cursor?: string;
}
export interface ListChannelsOutput {
  items: ChannelView[];
  cursor?: string;
  total: number;
}
export interface GetChannelInput {
  channelId: string;
}
export interface GetChannelOutput {
  channel?: ChannelView;
  error?: string;
}

// ─── Message (E2E-ENCRYPTED, private content + metadata) ─────────────

export interface MessageBody {
  messageId: string;
  channelId: string;
  authorDid: string;
  /** Empty string for top-level (non-threaded) messages. */
  parentId: string;
  text: string;
  sentAt: string;
}
export interface MessageView extends MessageBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface SendMessageInput {
  messageId: string;
  channelId: string;
  authorDid: string;
  text: string;
  parentId?: string;
  sentAt?: string;
  /** Extra DIDs to grant read-cap (owner always included): channel members / DM participants. */
  recipients?: string[];
}
export interface SendMessageOutput {
  status: "sent" | "rejected";
  uri?: string;
  keyId?: string;
  messageId?: string;
  error?: string;
}
export interface ListMessagesInput {
  channelId?: string;
  parentId?: string;
  limit?: number;
  cursor?: string;
}
export interface ListMessagesOutput {
  items: MessageView[];
  cursor?: string;
  total: number;
}
export interface GetMessageInput {
  messageId: string;
}
export interface GetMessageOutput {
  message?: MessageView;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  channelCount?: number;
  messageCount?: number;
  channelsByVisibility?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
export function isVisibility(v: unknown): v is ChannelVisibility {
  return typeof v === "string" && VISIBILITIES.includes(v as ChannelVisibility);
}
export function channelDidFor(id: string): string {
  return `${MESSENGER_DID_PREFIX}ch:${id.toLowerCase()}`;
}
export function channelRkey(id: string): string {
  return `ch-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
export function messageRkey(id: string): string {
  return `msg-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
