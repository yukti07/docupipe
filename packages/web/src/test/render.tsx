import { render as rtlRender } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"

const wrap = (ui: ReactElement) => (
  <TooltipProvider delayDuration={300}>{ui}</TooltipProvider>
)

/** The app's layout wraps everything in a tooltip provider, so tests do too —
 *  including on rerender, which otherwise replaces the whole tree with the
 *  bare element and loses the provider. */
export function render(ui: ReactElement) {
  const result = rtlRender(wrap(ui))
  return {
    user: userEvent.setup(),
    ...result,
    rerender: (next: ReactElement) => result.rerender(wrap(next)),
  }
}

export * from "@testing-library/react"
