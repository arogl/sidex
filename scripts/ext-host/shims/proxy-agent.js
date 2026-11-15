// `@vscode/proxy-agent` patches http/https/tls/fetch for proxy support and system certificates.
// SideX bundles the host without it, so extensions connect directly and these patches are no-ops.
export const LogLevel = { Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Critical: 5, Off: 6 };
export const ProxySupportSetting = {};
// The module patchers return the properties to overlay on `http`/`https`/`net`/`tls`; nothing to overlay.
export const createHttpPatch = () => ({});
export const createNetPatch = () => ({});
export const createTlsPatch = () => ({});
export const createFetchPatch = (_params, originalFetch) => originalFetch;
export const createWebSocketPatch = (_params, originalWebSocket) => originalWebSocket;
export const createProxyAuthorizationLookup = () => async () => undefined;
export const loadSystemCertificates = async () => [];
export const createProxyResolver = () => ({
	resolveProxyWithRequest: async () => undefined,
	resolveProxyURL: async () => undefined,
	resolveProxyByURL: async () => undefined
});

// proxyResolver.ts assigns `resolveProxyURL`/`resolveProxyByURL` onto `proxyAgent.default || proxyAgent`.
// A bundled ES namespace is not assignable, so expose a plain mutable default object like the CJS original.
export default {
	createFetchPatch,
	createWebSocketPatch
};
