/**
 * @su10/mail-connector — read-only mail connector. NODE-ONLY.
 *
 * Provider contract + adapters (generic IMAP / deterministic stub), per-connection
 * config assembly, and rate limiting. Mail TOOLS (Tool Broker surface) are added on
 * top of this layer. There is NO send capability anywhere in this package.
 */
export * from './port.js';
export * from './rateLimit.js';
export * from './config.js';
export * from './stubProvider.js';
export * from './imapProvider.js';
export * from './tools/deps.js';
export * from './registerMailTools.js';
