/**
 * Wire-contract version stamped on snapshots (additive `protocolVersion`).
 * Bump when making a breaking change; additive fields do not require a bump.
 * Independently-deployed halves (daemon, panel app, mobile dist) compare this
 * so deploy skew surfaces as a banner instead of silent drops (audit Q-2).
 */
export const PROTOCOL_VERSION = 1;
