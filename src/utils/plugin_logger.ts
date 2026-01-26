import type { Context } from 'koishi'

/**
 * Create a plugin logger that can be fully silenced when debug is disabled.
 * When debug=false, all logger methods become no-ops (no Koishi console output).
 */
export function getPluginLogger(ctx: Context, debug: boolean, name: string) {
  if (debug) return ctx.logger(name)
  const noop = () => {}
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    success: noop,
  } as any
}
