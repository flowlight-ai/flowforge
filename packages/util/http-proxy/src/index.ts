/**
 * Outbound HTTP proxy support for FlowForge.
 *
 * Node's built-in `fetch` ignores `HTTP_PROXY` and friends, so every process request would connect
 * directly no matter what the user exported. One policy is resolved from the launch environment and
 * published through the proxy environment the process and its children observe; Node ≥ 22 honours it
 * via its native proxy support, so every caller that issues a plain `fetch()` is covered without
 * touching its code.
 *
 * This is a library, not a plugin: transport policy has one answer per process, so there is nothing
 * for a composition to mount, swap, or scope.
 *
 * Two halves: the pure {@link resolveProxyPolicy} resolution and the install half that publishes the
 * resolved policy through the environment.
 * @module @flowforge/http-proxy
 */

export {
  clearedProxyEnv,
  installProxyFromEnvironment,
  proxyEnvironmentForChild,
  proxyRouteFor,
  type ProxyRoute,
} from './install.ts'
export {
  bypassesProxy,
  DIRECT_POLICY,
  isLoopbackHost,
  isSupportedProxyUrl,
  LOOPBACK_NO_PROXY,
  POLICY_ENV_NAMES,
  PROXY_ENV_NAMES,
  proxyForUrl,
  resolveProxyPolicy,
  type EnvLookup,
  type ProxyDiagnostic,
  type ProxyPolicy,
  type ProxyResolution,
} from './policy.ts'