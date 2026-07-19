/**
 * messenger kotoba — barrel. Consensys product-front split: public channel
 * directory plaintext + message bodies E2E (kotoba envelope, ADR-2605181100).
 * Real-time fan-out delivery + abuse-enforcement actions stay etzhayyim via
 * consent-capability.
 */
export * from "./types.js";
export {
  registerChannel,
  listChannels,
  getChannel,
  sendMessage,
  listMessages,
  getMessage,
  coverage,
} from "./registry.js";
