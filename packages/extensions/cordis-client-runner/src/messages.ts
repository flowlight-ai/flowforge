/**
 * Externalized user-facing copy for `@flowforge/cordis-client-runner`: every
 * teaching/redirect/error string that a browser half or a host call can trip is
 * owned here so no hard-coded UI text is scattered through the logic (rule 3).
 * Keys are stable; English text is the shipped language.
 *
 * @module @flowforge/cordis-client-runner/messages
 */

export const TIMER_REDIRECT
  = 'browser timer globals are unavailable in dynamic packages. Declare inject: [\'timer\'] on the returned plugin, '
    + 'query the Client Service directory for the exact API, and close over that plugin ctx. In React, create timers '
    + 'from an event handler or an effect and return callback-form disposers from the effect cleanup.'

/** Where each withheld browser global sends the author instead. */
export const DYNAMIC_CLIENT_REDIRECTS: Readonly<Record<string, string>> = {
  setTimeout: TIMER_REDIRECT,
  setInterval: TIMER_REDIRECT,
  clearTimeout: TIMER_REDIRECT,
  clearInterval: TIMER_REDIRECT,
  fetch:
    'network belongs to the HOST half: register a handler there and call it here via host.call(method, args).',
  require:
    'modules cannot be imported here. React arrives as the `React` closure symbol; everything else goes through ctx services or host.call.',
}

/** Messages the guard facade / evaluator emit. */
export const messages = {
  harnessSeat(prop: string): string {
    return `harness.${prop} belongs to the HOST half (\`code\`): register handlers there; the browser half calls them via host.call(method, args).`
  },
  parseFailed(detail: string): string {
    return `client half failed to parse in this browser: ${detail}\n`
      + 'The browser half is plain JavaScript (no JSX, no TypeScript); build elements with React.createElement.'
  },
  undefinedReturn(): string {
    return 'client half returned `undefined` — did you forget `return`?\n'
      + '  ✓ return (ctx) => { … }\n'
      + '  ✓ return { name: \'…\', inject: [\'slots\'], apply(ctx) { … } }'
  },
  invalidReturn(): string {
    return 'client half must `return` a plugin: a function, or an object with an `apply(ctx)` method'
  },
  slotNeedsName(): string {
    return 'slots.register(options, component) needs an options object with a `name`'
  },
  slotNameRequired(): string {
    return 'slots.register options need a string `name` (the target slot key)'
  },
  cordisSelfKeyOnly(): string {
    return 'tool.view.cordis only accepts key "self"; the runtime binds it to this Package'
  },
  themeTwoArgs(): string {
    return 'theme.overrideTokens(source, tokens) takes two arguments; source is replaced with your package id'
  },
  deniedService(prop: string): string {
    return `service "${prop}" is not declared by your plugin. Declare it on the plugin you return: `
      + `{ inject: ['${prop}', …], apply(ctx) { … } } — a plain \`function\` has no declaration site, `
      + 'so use the object form. The runtime then parks the package if the provider unloads.'
  },
  deniedRead(prop: string): string {
    return `dynamic ctx does not expose "${prop}". Available: ctx.on / ctx.provide / timer helpers after injecting timer, and any service your `
      + 'returned plugin declared in inject (slots and theme are the usual UI seats). Framework internals are withheld '
      + 'by design.'
  },
  readOnly(prop: string): string {
    return `dynamic ctx is read-only; cannot assign "${String(prop)}"`
  },
  contextReturned(service: string): string {
    return `service "${service}" returned a cordis Context, which the dynamic facade does not expose. `
      + 'Operate through your own plugin ctx and the services you declared — never another context.'
  },
  moduleLoaderMissing(): string {
    return 'cordis-client-runner: the package loader sink is missing (booted outside the web shell?)'
  },
  moduleImportFailed(): string {
    return 'module import failed (see the browser console)'
  },
}

/** Load / render failure copies. */
export const failureMessages = {
  renderSlot(slot: string, message: string, redirect: string): string {
    return `your entry in slot "${slot}" crashed while React rendered it: ${message}` + redirect
  },
  orchestrationStart(pluginId: string, packageId: string, run: string): string {
    return `Client activation ${pluginId}/${packageId} (${run}) failed:`
  },
  providerError(provider: string, method: string): string {
    return `Client inspect provider "${provider}" has no method "${method}"`
  },
  providerMissing(provider: string): string {
    return `Client inspect provider "${provider}" is unavailable`
  },
  cancelled(): string {
    return 'Client inspect query was cancelled'
  },
}

/** `host.call` teaching copy carried into wire-failure notices. */
export const wireMessages = {
  invokeFailure(where: string, code: string, message?: string): string {
    if (code === 'plugin-not-running') return `${where} found no active Host half — the Plugin is stopped or was removed.`
    if (code === 'stale-run') return `${where} belongs to an activation that has already been replaced.`
    if (code === 'method-not-found') return `${where} is not registered: the host half must declare it.`
    return `${where} failed inside the host handler: ${message}`
  },
  wireFailure(method: string, id: string, message: string): string {
    return `host.call("${method}") on ${id} did not complete: ${message}\n`
      + 'Both directions carry JSON only: pass plain JSON data as the argument — or omit it, and the handler receives '
      + `null — and answer with JSON (\`return null\` when there is nothing to report).`
  },
}