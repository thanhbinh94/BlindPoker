/** Tiny class-name composer: drops falsy parts, joins the rest with a space. */
export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')
