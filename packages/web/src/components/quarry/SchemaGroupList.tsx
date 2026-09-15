"use client"

import { SchemaCard } from "@/components/quarry/SchemaCard"
import { formatCount } from "@/lib/format"
import { groupByOriginalShape, type SchemaState } from "@/lib/schema"
import { cn } from "@/lib/utils"

/**
 * Schemas grouped by identical original shape, with a count. A file that held
 * three tables shows three cards, each labelled with where in the file it came
 * from — they are edited separately because they are separate tables.
 */
export function SchemaGroupList({
  schemas,
  openFileId,
  onOpen,
  className,
}: {
  schemas: SchemaState[]
  /** The panel belongs to a file, so every card from that file reads as open. */
  openFileId?: string | null
  onOpen: (schema: SchemaState) => void
  className?: string
}) {
  const groups = groupByOriginalShape(schemas)

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {groups.map((group) => (
        <section key={group.shapeHash}>
          <h3 className="mb-2 text-[12.5px] tabular-nums text-subtle-foreground">
            {formatCount(group.schemas.length)}{" "}
            {group.schemas.length === 1 ? "table" : "tables"} with this shape ·{" "}
            <span className="font-mono text-[11.5px]">
              {group.schemas[0].original.map((f) => f.key).join(", ")}
            </span>
          </h3>
          <ul className="grid gap-2 lg:grid-cols-2">
            {group.schemas.map((schema) => (
              <li key={`${schema.fileId}:${schema.schemaId}`}>
                <SchemaCard
                  schema={schema}
                  sharedWith={group.schemas.length - 1}
                  selected={openFileId === schema.fileId}
                  onOpen={() => onOpen(schema)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
