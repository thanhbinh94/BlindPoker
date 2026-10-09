import '@testing-library/jest-dom/vitest'

/**
 * jsdom has no `PointerEvent`, and with none `fireEvent.pointer*` falls back to a bare `Event` with no coordinates. This
 * stand-in is a `MouseEvent` (so `clientX`/`clientY`/`button` carry) that also keeps the pointer's own fields, so a test
 * can tell one pointer from another (Plan 21 ruling 5, Task 6 review M2).
 */
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStandIn extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
      this.isPrimary = init.isPrimary ?? true
    }
  }
  window.PointerEvent = PointerEventStandIn as unknown as typeof PointerEvent
}
