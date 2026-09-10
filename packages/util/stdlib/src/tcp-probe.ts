/**
 * TCP port probe — cheaply test whether a host:port accepts a connection.
 *
 * Ported from clowder-ai `api/src/utils/tcp-probe.ts`.
 * Only depends on Node built-ins (`node:net`).
 */

import { connect } from 'node:net'

/**
 * Resolves `true` when the TCP connection succeeds, `false` on error or timeout.
 * @param host - hostname or IP to probe.
 * @param port - port to probe.
 * @param timeoutMs - connection timeout in milliseconds (default 1000).
 */
export function tcpProbe(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, timeoutMs)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}