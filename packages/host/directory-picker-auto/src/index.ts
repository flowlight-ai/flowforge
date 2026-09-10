/**
 * Adaptive chooser of the directory-picker seam: resolves the host's situation
 * once at boot from sampled facts (bind host, SSH launch, display session,
 * Linux chooser binary) and selects the matching interaction — `native` or
 * `browse`. This port keeps the pure resolution and PATH-probe logic; the
 * composition-specific mounting that the deepseek source wired into a Loader
 * tree is the caller's responsibility here.
 * @module @flowforge/directory-picker-auto
 */

export { LOOPBACK_BIND_HOST, resolveDirectoryPickerBackend } from './resolve.ts'
export type {
  DirectoryPickerBackendKind,
  DirectoryPickerEnv,
  DirectoryPickerHostFacts,
} from './resolve.ts'
export { canExecute, hasLinuxChooserBinary } from './probe.ts'