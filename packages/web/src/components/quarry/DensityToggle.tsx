"use client"

import type { DensityOption } from "@/components/quarry/DataTable"
import { Button } from "@/components/ui/button"

export function DensityToggle({
  density,
  onChange,
}: {
  density: DensityOption
  onChange: (density: DensityOption) => void
}) {
  return (
    <div className="flex items-center rounded-lg border border-border-subtle bg-card p-0.5">
      {(["comfortable", "compact"] as DensityOption[]).map((option) => (
        <Button
          key={option}
          type="button"
          size="sm"
          variant={density === option ? "secondary" : "ghost"}
          aria-pressed={density === option}
          onClick={() => onChange(option)}
          className="h-7 rounded-md px-2.5 text-[12px] capitalize"
        >
          {option}
        </Button>
      ))}
    </div>
  )
}
