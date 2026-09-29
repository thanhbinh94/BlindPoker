/**
 * The first thing the Lite bundle runs, on purpose: `main.ts` imports this module before anything else.
 *
 * The single-executable loader's warning is raised *synchronously*, while the bundle's modules are still being
 * evaluated (`ws` probes for its optional add-ons at load), so a filter installed from `main()` would come too
 * late. An import that runs first is the earliest point our code can reach.
 */
import { installWarningFilter } from './warnings.js'

installWarningFilter()
