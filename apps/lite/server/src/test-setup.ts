/**
 * `node:sqlite` emits an `ExperimentalWarning` the first time it is loaded, once per Vitest worker,
 * straight into the reporter's output. It is expected and says nothing about the run, so the suite uses
 * the exe's own filter (`warnings.ts`): exactly the warnings it names are dropped, and every other one —
 * other `ExperimentalWarning`s included — goes back to Node's own handlers.
 */
import { installWarningFilter } from './warnings.js'

installWarningFilter()
