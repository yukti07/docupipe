import { expect, test, type Page } from "@playwright/test"

/**
 * The seven endpoints are not implemented in this app yet, so they are fulfilled
 * here. Everything else — the tables, the evidence, the merge check — runs
 * against the real fixture API the app ships with, which is the same code that
 * will call the live routes when they land.
 */

const PUT_ORIGIN = "https://storage.example.test"
const REQUEST_ID = "req_e2e"

type Stage = "QUEUED" | "EXTRACTING" | "FILLING" | "DONE" | "FAILED"

const field = (key: string, type: string) => ({ key, label: key, type, origin: "detected" })

const SHAPE = {
  tableOrd: 0,
  tableLabel: "table 1",
  version: 1,
  shapeHash: "9c1f2a7e",
  matchingFileCount: 2,
  fields: [
    field("invoice_number", "text"),
    field("invoice_date", "date"),
    field("supplier", "text"),
    field("net", "currency"),
    field("vat", "currency"),
    // Inferred as a plain number, as in the contract's own example — so
    // correcting it to currency is a real edit rather than a no-op.
    field("total", "number"),
  ],
}

const schemaReady = (fileId: string, fileName: string, schemaId: string) => ({
  fileId,
  fileName,
  filePath: `requests/${REQUEST_ID}/input/${fileName}`,
  schemaId,
  status: "ready",
  schema: SHAPE,
})

const schemaFailed = (fileId: string, fileName: string) => ({
  fileId,
  fileName,
  filePath: `requests/${REQUEST_ID}/input/${fileName}`,
  schemaId: null,
  status: "failed",
  schema: null,
  failure: {
    class: "extract_empty",
    message: "Its pages are images with no readable text.",
    nextStep: "Remove it, or convert it anyway and it will be skipped.",
  },
})

const resultEntry = (
  fileName: string,
  schemaId: string,
  stage: Stage,
  over: Record<string, unknown> = {},
) => ({
  fileId: `file_${schemaId}`,
  fileName,
  schemaId,
  stage,
  ...over,
})

type Backend = {
  schemas?: unknown[]
  convertAvailable?: boolean
  convertBlockedReason?: string | null
  pending?: number
  result?: Record<string, unknown>
}

async function mockSeven(page: Page, options: Backend = {}) {
  const {
    schemas = [schemaReady("file_1", "invoice-1043.pdf", "sch_31"), schemaReady("file_2", "invoice-1044.pdf", "sch_32")],
    convertAvailable = true,
    convertBlockedReason = null,
    pending = 0,
    result,
  } = options

  // Flipped by the convert route, so the result poll can report an empty
  // request before the gate and a running one after it.
  let converted = false

  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  })

  await page.route("**/api/register", (route) => route.fulfill(json({ status: "ok" })))

  await page.route("**/api/getSignedUrl", async (route) => {
    const body = route.request().postDataJSON() as { files: string[] }
    await route.fulfill(
      json({
        userId: "usr_e2e",
        requestId: REQUEST_ID,
        files: body.files.map((fileName, index) => ({
          fileId: `file_${index + 1}`,
          fileName,
          filePath: `${PUT_ORIGIN}/${index}?X-Goog-Signature=abc`,
          uploadHeaders: { "Content-Type": "application/pdf" },
          expiresAt: "2026-09-14T11:05:00Z",
        })),
      }),
    )
  })

  await page.route(`${PUT_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*" } }),
  )

  await page.route("**/api/upload", async (route) => {
    const body = route.request().postDataJSON() as { files: { fileId: string }[] }
    await route.fulfill(
      json({
        status: "ok",
        files: body.files.map((f) => ({ fileId: f.fileId, stage: "UPLOADED" })),
      }),
    )
  })

  await page.route("**/api/polling/schema", (route) =>
    route.fulfill(
      json({
        userId: "usr_e2e",
        requestId: REQUEST_ID,
        pending,
        convertAvailable,
        convertBlockedReason,
        files: schemas,
      }),
    ),
  )

  await page.route("**/api/updateSchema", async (route) => {
    const body = route.request().postDataJSON() as { files: { schemaId: string }[] }
    await route.fulfill(
      json({
        status: "ok",
        updated: body.files.map((f) => ({ schemaId: f.schemaId, version: 2 })),
      }),
    )
  })

  await page.route("**/api/convert", (route) => {
    converted = true
    return route.fulfill(json({ status: "received", queued: 2, skipped: 0 }))
  })

  // Before Convert the request has nothing queued, which is how the screen
  // works out on load that it is still in Prepare.
  const nothingQueued = {
    userId: "usr_e2e",
    requestId: REQUEST_ID,
    status: "CONVERTING",
    pausedUntil: null,
    counts: { queued: 0, extracting: 0, filling: 0, done: 0, failed: 0 },
    rowsSoFar: 0,
    estimatedSecondsRemaining: null,
    allowance: { used: 0, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
    files: [],
  }

  await page.route("**/api/polling/result", (route) => {
    if (!result && !converted) return route.fulfill(json(nothingQueued))
    return route.fulfill(
      json(
        result ?? {
          userId: "usr_e2e",
          requestId: REQUEST_ID,
          status: "CONVERTING",
          pausedUntil: null,
          counts: { queued: 1, extracting: 0, filling: 0, done: 1, failed: 0 },
          rowsSoFar: 22,
          estimatedSecondsRemaining: 840,
          allowance: { used: 1840, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
          files: [
            resultEntry("invoice-1044.pdf", "sch_32", "DONE", {
              rowCount: 22,
              fieldCount: 6,
              toCheckCount: 3,
            }),
            resultEntry("invoice-1043.pdf", "sch_31", "QUEUED"),
          ],
        },
      ),
    )
  })
}

const pdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 fixture"),
})

/** Drops files on the workspace and lands on the batch screen. */
async function dropFiles(page: Page, names: string[]) {
  await page.goto("/")
  await expect(page.getByText("Drop your documents here")).toBeVisible()
  // The zone takes nothing until the workspace has registered.
  // The button repeats its disabled reason in its own label, so the input is
  // addressed by element rather than by accessible name alone.
  const chooser = page.locator('input[type="file"][aria-label="Choose files"]')
  await expect(chooser).toBeEnabled()
  await chooser.setInputFiles(names.map(pdf))
  await expect(page).toHaveURL(/\/b\/req_/)
}

/** Seeds the browser-local workspace so a batch opens straight onto Converting. */
async function seedConverting(page: Page, phase = "converting") {
  await page.addInitScript(
    ([requestId, batchPhase]) => {
      localStorage.setItem("quarry.userId", "usr_e2e")
      localStorage.setItem("quarry.registered", "usr_e2e")
      localStorage.setItem(
        "quarry.workspace",
        JSON.stringify([
          {
            requestId,
            name: "Q3 invoices",
            createdAt: "2026-09-14T10:00:00Z",
            fileCount: 2,
            phase: batchPhase,
            summary: {},
          },
        ]),
      )
    },
    [REQUEST_ID, phase],
  )
}

test.describe("the happy path", () => {
  test("drop, shapes, edit a type, apply to all, convert, open a table, evidence, download", async ({
    page,
  }) => {
    await mockSeven(page)
    await dropFiles(page, ["invoice-1043.pdf", "invoice-1044.pdf"])

    // Shapes come back while the header counts uploads and schemas separately.
    await expect(page.getByText(/2 of 2 uploaded · 2 schemas back/)).toBeVisible()

    // Edit a type in the panel beside the list, not over it.
    await page.getByRole("button", { name: "Preview / Edit" }).first().click()
    const panel = page.getByRole("complementary", { name: "Schema" })
    await expect(panel).toBeVisible()
    await panel.getByRole("combobox", { name: "Type of total" }).click()
    await page.getByRole("option", { name: "currency" }).click()

    // Apply to all names the files before it commits to them.
    await panel.getByRole("button", { name: /Apply to 1 file/ }).click()
    await expect(page.getByText("invoice-1044.pdf · table 1")).toBeVisible()
    await page.getByRole("button", { name: /Include these 1/ }).click()
    await panel.getByRole("button", { name: "Save" }).click()
    await expect(panel.getByText("Saved to 2 files.")).toBeVisible()

    // The gate.
    await page.getByRole("button", { name: /^Convert/ }).click()

    // A finished table opens while the rest of the batch is still running.
    await expect(page.getByText(/1 of 2 done · 1 waiting · 3 to check/)).toBeVisible()
    await expect(page.getByText("Queued")).toBeVisible()
    await page.getByRole("link", { name: /View/ }).click()

    await expect(page).toHaveURL(/\/t\/sch_32/)
    await expect(page.getByText(/22 rows · 6 fields/)).toBeVisible()

    // Evidence opens from a cell, and draws the box on the page it came from.
    await page.getByRole("button", { name: /216\.40 — show where this came from/ }).first().click()
    const evidence = page.getByRole("complementary", { name: "Evidence" })
    await expect(evidence).toBeVisible()
    await expect(evidence.getByText(/20% of 3,480.00 would be 696.00/)).toBeVisible()
    await expect(evidence.getByRole("img", { name: /Highlighted on page/ })).toBeVisible()

    // Esc closes it without leaving the table.
    await page.keyboard.press("Escape")
    await expect(evidence).toBeHidden()

    // One click, no dialog.
    const download = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download" }).click()
    expect((await download).suggestedFilename()).toBe("invoice-1044.csv")
  })
})

test.describe("the gate", () => {
  test("one unreadable file does not block Convert", async ({ page }) => {
    await mockSeven(page, {
      schemas: [
        schemaReady("file_1", "invoice-1043.pdf", "sch_31"),
        schemaFailed("file_2", "scan-0091.pdf"),
      ],
      convertAvailable: true,
    })
    await dropFiles(page, ["invoice-1043.pdf", "scan-0091.pdf"])

    await expect(page.getByText(/1 file won't convert/)).toBeVisible()
    await expect(page.getByText("Its pages are images with no readable text.")).toBeVisible()
    await expect(page.getByRole("button", { name: /^Convert/ })).toBeEnabled()
  })

  test("a disabled Convert says what would enable it", async ({ page }) => {
    await mockSeven(page, {
      schemas: [schemaReady("file_1", "invoice-1043.pdf", "sch_31")],
      pending: 7,
      convertAvailable: false,
      convertBlockedReason: "7 files are still reading their shape.",
    })
    await dropFiles(page, ["invoice-1043.pdf"])

    await expect(page.getByText("7 files are still reading their shape.")).toBeVisible()
    await expect(page.getByRole("button", { name: /^Convert/ })).toBeDisabled()
  })
})

test.describe("the pause", () => {
  test("a quota pause reads as a pause with a time, and finished tables stay downloadable", async ({
    page,
  }) => {
    await seedConverting(page)
    await mockSeven(page, {
      result: {
        userId: "usr_e2e",
        requestId: REQUEST_ID,
        status: "PAUSED",
        pausedUntil: "2026-09-14T14:32:00Z",
        counts: { queued: 1, extracting: 0, filling: 0, done: 1, failed: 0 },
        rowsSoFar: 22,
        estimatedSecondsRemaining: null,
        allowance: { used: 5000, limit: 5000, resetsAt: "2026-09-15T00:00:00Z" },
        files: [
          resultEntry("invoice-1044.pdf", "sch_32", "DONE", {
            rowCount: 22,
            fieldCount: 6,
            toCheckCount: 3,
          }),
          resultEntry("invoice-1043.pdf", "sch_31", "QUEUED"),
        ],
      },
    })

    await page.goto(`/b/${REQUEST_ID}`)

    await expect(page.getByText(/Daily page allowance used up/)).toBeVisible()
    await expect(page.getByText(/Picking up again at \d{2}:\d{2}/)).toBeVisible()
    await expect(page.getByText(/stays open and downloadable/)).toBeVisible()
    await expect(page.getByText(/1 of 2 done · picking up again at/)).toBeVisible()

    // Nothing already finished is lost.
    await expect(page.getByRole("link", { name: /View/ })).toBeVisible()
    await expect(page.getByRole("link", { name: /Download/ })).toBeVisible()
  })
})

test.describe("the pages that should almost never appear", () => {
  test("a link that goes nowhere offers a way back", async ({ page }) => {
    await page.goto("/nothing-here")
    await expect(page.getByText("That link doesn't go anywhere")).toBeVisible()
    await page.getByRole("link", { name: "Back to your workspace" }).click()
    await expect(page).toHaveURL("/")
  })
})
