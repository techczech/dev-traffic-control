import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, PanelRight } from 'lucide-react'
import type { DockMenuState, DockPlaceId } from '../../../shared/ipc'
import { useApp } from '../state/app'
import { displayChord } from '../commands/keymap'
import { useCommandScope, useCommands } from '../commands/provider'

/**
 * Pin and dock are separate: the pin is whether the window stays on top, the
 * dock is where it goes. A normal click docks at the last-used place; the ▾
 * part opens the menu of places.
 *
 * A split button beside the pin. The main part docks the window as the
 * sidebar at the last-used place; ▾ opens the four places (right or left edge,
 * this screen or the other one). With one screen the two "other screen"
 * places are disabled. Neither part touches the pin.
 *
 * The menu's places and which one was last used come from main, which knows
 * the displays; the menu is read afresh each time it opens.
 */
export function DockButton(): React.JSX.Element {
  const { dock } = useApp()
  const commands = useCommands()
  const [menu, setMenu] = useState<DockMenuState | null>(null)
  const [active, setActive] = useState(0)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const group = useRef<HTMLSpanElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])
  const open = menu !== null

  const close = useCallback((): void => {
    setMenu(null)
    more.current?.focus()
  }, [])

  const openMenu = useCallback((): void => {
    const rect = more.current?.getBoundingClientRect()
    setAnchor(rect ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : null)
    void window.qa.dockMenu().then((state) => {
      if (!state) return
      const current = state.places.findIndex((place) => place.current && place.enabled)
      setActive(Math.max(0, current))
      setMenu(state)
    })
  }, [])

  const choose = useCallback(
    (place: DockPlaceId): void => {
      dock(place)
      close()
    },
    [close, dock]
  )

  // A click anywhere outside the button and its menu closes the menu.
  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent): void {
      if (group.current && event.target instanceof Node && group.current.contains(event.target))
        return
      setMenu(null)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    if (open) items.current[active]?.focus()
  }, [open, active])

  const step = (delta: number): void => {
    if (!menu) return
    const enabled = menu.places.map((place, index) => (place.enabled ? index : -1))
    const usable = enabled.filter((index) => index >= 0)
    const at = usable.indexOf(active)
    const next = usable[(at + delta + usable.length) % usable.length]
    if (next !== undefined) setActive(next)
  }

  // The menu's keys go through the command layer, above whatever
  // surface is underneath: ↑/↓ move, Enter docks, Esc closes.
  useCommandScope({
    'window.choose-dock-place': () => (open ? close() : openMenu()),
    'nav.move-down': { enabled: open, priority: 200, handler: () => step(1) },
    'nav.move-up': { enabled: open, priority: 200, handler: () => step(-1) },
    'nav.open-selection': {
      enabled: open,
      priority: 200,
      handler: () => {
        const place = menu?.places[active]
        if (place?.enabled) choose(place.id)
      }
    },
    'app.close-back': { enabled: open, priority: 200, handler: close }
  })

  const dockChord = displayChord(commands.binding('window.dock'))
  const menuChord = displayChord(commands.binding('window.choose-dock-place'))

  return (
    <span className="dockbtn" ref={group} role="group" aria-label="Dock">
      <button
        type="button"
        className="iconbtn dockbtn-main"
        aria-label="Dock as the sidebar"
        title={`Dock as the sidebar at the last place${dockChord ? ` (${dockChord})` : ''}`}
        onClick={() => commands.run('window.dock')}
      >
        <PanelRight className="ic" strokeWidth={2} />
      </button>
      <button
        type="button"
        ref={more}
        className={`iconbtn dockbtn-more${open ? ' on' : ''}`}
        aria-label="Choose where to dock"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Choose where to dock${menuChord ? ` (${menuChord})` : ''}`}
        onClick={() => (open ? close() : openMenu())}
      >
        <ChevronDown className="ic" strokeWidth={2} />
      </button>
      {menu && (
        <div
          className="scopemenu dockmenu"
          role="menu"
          aria-label="Dock the sidebar"
          style={anchor ? { top: anchor.top, right: anchor.right } : undefined}
        >
          <div className="scopemenu-head" aria-hidden="true">
            Dock the sidebar
          </div>
          {menu.places.map((place, index) => (
            <button
              key={place.id}
              type="button"
              ref={(element) => {
                items.current[index] = element
              }}
              role="menuitemradio"
              aria-checked={place.current}
              className={place.current ? 'on' : ''}
              disabled={!place.enabled}
              tabIndex={index === active ? 0 : -1}
              onClick={() => choose(place.id)}
            >
              <span>{place.label}</span>
              {place.current && <Check className="ic" strokeWidth={2.2} />}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
