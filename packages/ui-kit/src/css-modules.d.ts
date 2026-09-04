declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css'

/** Vite's `?raw` suffix: the file's text, which is how a test reads a stylesheet it wants to assert on. */
declare module '*.css?raw' {
  const source: string
  export default source
}
