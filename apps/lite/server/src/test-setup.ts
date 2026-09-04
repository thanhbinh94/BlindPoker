/**
 * `node:sqlite` emits an `ExperimentalWarning` the first time it is loaded, once per Vitest worker,
 * straight into the reporter's output. It is expected and says nothing about the run, so drop
 * exactly that warning and hand every other one — other `ExperimentalWarning`s included — back to
 * Node's own handlers, which is why we re-dispatch instead of installing a swallow-all listener.
 */
const defaultHandlers = process.listeners('warning') as ((warning: Error) => void)[]
for (const handler of defaultHandlers) process.removeListener('warning', handler)

process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite is an experimental feature')) return
  for (const handler of defaultHandlers) handler(warning)
})
