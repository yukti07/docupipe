import { render as rtlRender } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"

export function render(ui: ReactElement) {
  return { user: userEvent.setup(), ...rtlRender(ui) }
}

export * from "@testing-library/react"
