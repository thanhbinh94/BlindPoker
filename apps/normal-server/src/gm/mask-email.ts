/**
 * An email address as the GM search lists it (spec 2026-10-18 Q6): the first letter and the domain, so a GM can tell
 * two accounts apart without the screen showing anyone's whole address. The full address is only on the detail page.
 *
 * Anything without a local part before an `@` is not an address this server stored (`users.email` is checked at
 * registration), and comes back fully hidden rather than half-shown.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at < 1) return '***'
  return `${email[0]!}***${email.slice(at)}`
}
