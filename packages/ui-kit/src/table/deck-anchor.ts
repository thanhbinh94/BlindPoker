import { createContext, useContext, type RefObject } from 'react'

/**
 * Where the deck is: `Card` measures itself against it to slide in from there (spec 2026-10-08 §3). `PokerTable` provides
 * its `Deck`. Absent, a card has nothing to come from and keeps its plain fade-in — the result card, the playground, a test.
 * A module of its own so that `Card` (which reads it) and `Deck` (which draws `Card`'s back) never import each other.
 */
const DeckAnchorContext = createContext<RefObject<HTMLElement | null> | null>(null)

export const DeckAnchorProvider = DeckAnchorContext.Provider

export const useDeckAnchor = (): RefObject<HTMLElement | null> | null => useContext(DeckAnchorContext)
