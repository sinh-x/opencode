import { describe, expect, test } from "bun:test"
import { createBackdropDismissGuard } from "../../src/ui/dialog"

describe("createBackdropDismissGuard", () => {
  test("suppresses onMouseUp when no pairing onMouseDown was received", () => {
    let closed = 0
    const guard = createBackdropDismissGuard(() => false)
    // A mouseup without a preceding mousedown (e.g. dialog opened via mouseup from [change] text)
    // must not close the dialog.
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(true)
    expect(closed).toBe(0)
  })

  test("closes when mousedown+mouseup both happen on backdrop with no selection", () => {
    const guard = createBackdropDismissGuard(() => false)
    guard.onMouseDown()
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(false)
  })

  test("suppresses close when a text selection was present at mousedown", () => {
    const guard = createBackdropDismissGuard(() => true)
    guard.onMouseDown()
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(true)
  })

  test("does not suppress a second mouseup after the first consumed the mousedown", () => {
    const guard = createBackdropDismissGuard(() => false)
    guard.onMouseDown()
    guard.onMouseUp()
    // Second mouseup with no fresh mousedown must be suppressed.
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(true)
  })

  test("suppressDismiss resets dismiss flag so next paired mouseup closes", () => {
    const guard = createBackdropDismissGuard(() => true)
    guard.onMouseDown()
    guard.suppressDismiss()
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(false)
  })

  test("suppressDismiss is idempotent and safe when no mousedown happened", () => {
    const guard = createBackdropDismissGuard(() => false)
    guard.suppressDismiss()
    guard.suppressDismiss()
    const suppressed = guard.onMouseUp()
    expect(suppressed).toBe(true)
  })

  test("paired mousedown+mouseup with selection then suppressDismiss still closes", () => {
    const guard = createBackdropDismissGuard(() => true)
    guard.onMouseDown()
    guard.suppressDismiss()
    expect(guard.onMouseUp()).toBe(false)
  })

  test("fresh mousedown after a suppressed mouseup re-enables close", () => {
    const guard = createBackdropDismissGuard(() => false)
    // First cycle: suppressed because no mousedown
    expect(guard.onMouseUp()).toBe(true)
    // Second cycle: fresh mousedown+mouseup closes
    guard.onMouseDown()
    expect(guard.onMouseUp()).toBe(false)
  })
})