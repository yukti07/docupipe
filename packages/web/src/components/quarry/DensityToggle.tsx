"use client"

import { Button } from "@/components/ui/button"
import type { DensityOption } from "@/lib/density"

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
