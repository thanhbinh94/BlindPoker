import type { Language } from '@bp/ui-kit'
import type { NormalApi } from '../../api.js'

/**
 * What every tab of the console is handed.
 *
 * `api` is the console's own guarded copy (`GmScreen`): a `403 FORBIDDEN` from any call on it has already told the
 * app the role is gone by the time the call's promise rejects, so a tab only has to render its failure. `guard`
 * is the same check for a failure that did not come through `api` — call it in a `catch` and it reports a lost role
 * once and rethrows.
 */
export interface GmTabProps {
  api: NormalApi
  lang: Language
  guard: (cause: unknown) => never
}
