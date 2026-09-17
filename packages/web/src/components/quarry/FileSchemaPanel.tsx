"use client"

import { SchemaEditor } from "@/components/quarry/SchemaEditor"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Failure, SchemaField } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import type { SchemaState, UpdateTarget } from "@/lib/schema"

/**
 * The panel belongs to a *file*, not to a table. A file that held ten tables
 * opens once and offers all ten here, because the row it was opened from is one
 * file and ten buttons on one row is not a choice anyone wants to make.
 *
 * Every table's editor stays mounted behind its tab, so moving between them and
 * back keeps an edit that has not been saved yet.
 */
export function FileSchemaPanel({
  fileName,
  schemas,
  reading,
  noShape,
  targetsFor,
  onSave,
  onClose,
  frozen,
}: {
  fileName: string
  /** Empty while the shape is still being read, or when none was found. */
  schemas: SchemaState[]
  reading?: boolean
  noShape?: Failure
  targetsFor: (schema: SchemaState) => UpdateTarget[]
  onSave: (
    schemaId: string,
    fields: SchemaField[],
    alsoApplyTo: string[],
  ) => Promise<{ ok: true } | { ok: false; failure: Failure }>
  onClose: () => void
  frozen?: boolean
}) {
  if (schemas.length <= 1) {
    const only = schemas[0] ?? null
    return (
      <SchemaEditor
        schema={only}
        fileName={fileName}
        reading={reading}
        noShape={noShape}
        updateTargets={only ? targetsFor(only) : []}
        onClose={onClose}
        frozen={frozen}
        onSave={(fields, alsoApplyTo) => onSave(only!.schemaId, fields, alsoApplyTo)}
        className="min-h-0 flex-1"
      />
    )
  }

  return (
    <Tabs defaultValue={schemas[0].schemaId} className="min-h-0 flex-1 gap-0">
      <div className="border-b border-border-subtle px-3 pt-3">
        <p className="truncate px-1 pb-2 text-[11.5px] tabular-nums text-muted-foreground">
          {formatCount(schemas.length)} tables in this file
        </p>
        <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1 pb-2">
          {schemas.map((schema) => (
            <TabsTrigger
              key={schema.schemaId}
              value={schema.schemaId}
              className="h-8 flex-none rounded-lg border border-border-subtle px-2.5 text-[12.5px] data-[state=active]:border-primary-tint-border data-[state=active]:bg-primary-tint"
            >
              {schema.tableLabel}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {schemas.map((schema) => (
        <TabsContent
          key={schema.schemaId}
          value={schema.schemaId}
          // Kept mounted: switching tabs must not throw away an unsaved edit.
          forceMount
          className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        >
          <SchemaEditor
            schema={schema}
            fileName={fileName}
            updateTargets={targetsFor(schema)}
            onClose={onClose}
            frozen={frozen}
            onSave={(fields, alsoApplyTo) => onSave(schema.schemaId, fields, alsoApplyTo)}
            className="min-h-0 flex-1"
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
