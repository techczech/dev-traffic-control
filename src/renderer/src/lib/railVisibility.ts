import { useEffect, useState } from 'react'

/**
 * Whether the project rail fits beside a surface — decided by the window's
 * MEASURED width, never by the `widthPreset` setting.
 *
 * `widthPreset` is a docking preference: its `wide` means 860px
 * (`WIDE_WIDTH` in src/main/windowLayout.ts), which is a docked strip, not a
 * measurement. The first installed build gated the rail on that setting, so a
 * fixed 252px rail landed inside an 860px window beside a Dashboard that has
 * its own right-hand panel, and request titles wrapped one word per line.
 */

/**
 * The rail's own width, in step with `flex-basis` in
 * `src/renderer/src/assets/project-rail.css` (the only pixel value this
 * module keeps).
 */
export const RAIL_WIDTH = 252

/**
 * The narrowest a surface beside the rail is allowed to be.
 *
 * Where the number comes from: `main.css` reflows the Dashboard's 70/30 split
 * into a single stacked strip at `@media (max-width: 760px)`, with the note
 * that "the 70/30 split needs ~720px to hold its fixed row columns". 761 is
 * therefore the first width at which the wide layout is the one the stylesheet
 * intends. That media query measures the VIEWPORT, so it cannot see a surface
 * squeezed by the rail inside a wide-enough window — which is exactly how the
 * defect got through. This constant is the check the media query cannot make.
 */
export const MIN_SURFACE_WIDTH_BESIDE_RAIL = 761

/**
 * The measured window width at or above which the rail is shown: the rail plus
 * the narrowest surface it may sit beside. 252 + 761 = 1013.
 */
export const RAIL_MIN_WINDOW_WIDTH = RAIL_WIDTH + MIN_SURFACE_WIDTH_BESIDE_RAIL

/**
 * Below the threshold the rail does not sit beside a surface. It hides rather
 * than shrinks deliberately: any width a shrunken rail kept would be taken from
 * the surface beside it, which is the defect this repairs. Below the threshold
 * the same list is shown as the front page instead — see
 * `projectListPresentation`.
 */
export function railFitsWindow(windowWidth: number): boolean {
  return windowWidth >= RAIL_MIN_WINDOW_WIDTH
}

/**
 * One project list, three states it can be in.
 *
 * - `rail` — wide: the list sits beside the content, permanently.
 * - `front-page` — narrow, no project picked yet: the list *is* the window.
 *   The app's front page. No tab bar, because the six surfaces belong to a
 *   scope and none has been chosen.
 * - `pushed-in` — narrow, pushed into a project: the tabs return and a back
 *   control appears beside the scope indicator.
 */
export type ProjectListPresentation = 'rail' | 'front-page' | 'pushed-in'

/**
 * The presentation as a pure function of the window's measured width and
 * whether the window is sitting on its front page.
 *
 * One value, so the rail and the front page are mutually exclusive by
 * construction: a caller renders the arm this returns and there is no
 * combination of inputs that asks for both. Two independent booleans would let
 * a narrow window draw a 252px rail beside a front page, which must
 * never happen.
 */
export function projectListPresentation(
  windowWidth: number,
  onFrontPage: boolean
): ProjectListPresentation {
  if (railFitsWindow(windowWidth)) return 'rail'
  return onFrontPage ? 'front-page' : 'pushed-in'
}

/** The window's current inner width, re-read on resize. */
export function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? RAIL_MIN_WINDOW_WIDTH : window.innerWidth
  )
  useEffect(() => {
    const measure = (): void => setWidth(window.innerWidth)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return width
}

/**
 * The presentation for the live window. Every call site asks this one hook, so
 * the titlebar's back control and the shell's list cannot disagree about which
 * presentation is on screen.
 */
export function useProjectListPresentation(onFrontPage: boolean): ProjectListPresentation {
  return projectListPresentation(useWindowWidth(), onFrontPage)
}
