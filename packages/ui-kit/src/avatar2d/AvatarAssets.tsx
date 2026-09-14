import { createContext, useContext, type ReactNode } from 'react'

/** Normal serves `/avatar/`; Lite bundles its own copy and serves it relative to the app shell. Either way this is
 * the one thing `Chibi` needs from the host app — where the PNGs live — so nothing else in the kit couples to it. */
const DEFAULT_BASE = '/avatar/'

const AvatarAssetsContext = createContext<string>(DEFAULT_BASE)

export interface AvatarAssetsProps {
  base: string
  children: ReactNode
}

/** Provides the URL prefix every `Chibi` in the tree resolves its layer images against. Without a provider,
 * `Chibi` falls back to `'/avatar/'` — the Normal web layout — so the kit works un-wrapped in tests and stories. */
export function AvatarAssets({ base, children }: AvatarAssetsProps) {
  return <AvatarAssetsContext.Provider value={base}>{children}</AvatarAssetsContext.Provider>
}

/** The asset base the nearest `AvatarAssets` provider set, or the default when there is none. */
export function useAvatarAssetsBase(): string {
  return useContext(AvatarAssetsContext)
}

/** A layer's URL at one pixel density: `${prefix}${file}@${density}x.png`. */
export function assetUrl(prefix: string, file: string, density: 1 | 2): string {
  return `${prefix}${file}@${density}x.png`
}
