/**
 * The public base path, in a form that also compiles on the edge.
 *
 * `asset()` lives in ./games and reads `import.meta.env.BASE_URL`. That is a Vite
 * build-time value and it does not exist in Deno, which is why the slot rules —
 * pure maths, no DOM — could not be imported by the server. They can now: only
 * the artwork goes through this, and the rules never touch it.
 *
 * Computed without optional chaining so the same expression type-checks under
 * both `tsc -b` and the edge build.
 */
// In the browser build Vite replaces `import.meta.env.BASE_URL` with a literal.
// In Deno the whole expression is left alone and evaluates to '/', which is all
// the edge needs: it never renders artwork, it only carries the strings.
export const ASSET_BASE: string = (import.meta?.env?.BASE_URL as string | undefined) ?? '/'
