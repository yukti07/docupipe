import { expect, test, type Page } from "@playwright/test"

/**
 * End to end against the REAL seven routes.
 *
 * Nothing here is mocked with `page.route()` any more. The app talks to
 * `/api/register`, `/api/getSignedUrl`, `/api/upload`, `/api/polling/schema`,
 * `/api/updateSchema`, `/api/convert` and `/api/polling/result` for real, and
 * those talk to Postgres, to local storage and to the Python worker.
 *
 * REQUIRES a running stack. From the repo root:
 *
 *     docker compose up --build          # Postgres, migrations, worker, sweep
 *     cd packages/web && npm run dev     # with .env.example's local settings
 *     npm run test:e2e
 *
 * The one thing still standing in for something else: §0.9's surfaces — the
 * table, the evidence panel, raw text, merge — have no endpoint yet, so the
 * app's own `FixtureApi` serves them. That is the same code that will call the
 * live routes when they land, and it is in-app rather than intercepted here.
 *
 * WHAT THESE CAN AND CANNOT ASSERT
 *
 * The inspect worker writes a PLACEHOLDER shape in this phase and the convert
 * worker writes one line of text, so nothing here asserts on extracted values.
 * What it does assert is the part that is real and that no unit test can
 * reach: a file gets an id, its bytes land, a schema comes back, THE GATE
 * HOLDS, Convert moves it, and the result poll reports it finished.
 */

const pdf = (name: string, body = "%PDF-1.4 fixture") => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(body),
})

/**
 * A file that passes the client's pre-flight and fails at the WORKER.
 *
 * Named `.pdf`, and the bytes are a ZIP. Pre-flight only sees the extension
 * and the size, so this is the shortest route to a genuinely server-settled
 * failure — which is a different path, and different copy, from a file the
 * browser rejects before it is ever sent.
 */
const lyingPdf = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)]),
})

type Upload = { name: string; mimeType: string; buffer: Buffer }

/** Drops files on the workspace and lands on the batch screen. */
async function dropFiles(page: Page, files: Upload[]): Promise<string> {
  await page.goto("/")
  await expect(page.getByText("Drop your documents here")).toBeVisible()

  // The zone takes nothing until the workspace has registered, which is a real
  // round trip to /api/register now rather than a fulfilled promise.
  const chooser = page.locator('input[type="file"][aria-label="Choose files"]')
  await expect(chooser).toBeEnabled()
  await chooser.setInputFiles(files)

  await expect(page).toHaveURL(/\/b\/req_/)
  return new URL(page.url()).pathname.split("/")[2]
}

/** The one honest status line, in the banner. Scoped because the same counts
 *  also appear as a section heading further down the page. */
function status(page: Page) {
  return page.getByRole("banner").locator('p[aria-live="polite"]')
}

/** Schemas arrive only once the worker has claimed the file and written them. */
async function waitForSchemas(page: Page, count: number) {
  await expect(status(page)).toHaveText(
    new RegExp(`${count} schemas? back`),
    { timeout: 30_000 },
  )
}

test.describe("the spine, for real", () => {
  test("drop, shapes come back from the worker, edit a type, convert, results", async ({
    page,
  }) => {
    await dropFiles(page, [pdf("invoice-1043.pdf"), pdf("invoice-1044.pdf")])

    // Both uploaded through a signed URL and confirmed against the object that
    // is actually in storage — not against the fact a URL was handed out.
    await expect(status(page)).toHaveText(/2 of 2 uploaded/, { timeout: 30_000 })

    // Written by the inspect worker, fetched by /api/polling/schema.
    await waitForSchemas(page, 2)

    // ── THE GATE ──────────────────────────────────────────────────────────
    // Nothing has been converted. This is the assertion that matters most and
    // the one only a real backend can make: anyone can build a pipeline that
    // processes on upload; the point is that this one does not.
    await expect(page.getByRole("button", { name: /^Convert/ })).toBeEnabled()
    await expect(page.getByText(/Queued|Extracting|Done/)).toHaveCount(0)

    // An edit against a real schema row, saved through /api/updateSchema.
    await page.getByRole("button", { name: "Preview / Edit" }).first().click()
    const panel = page.getByRole("complementary", { name: "Schema" })
    await expect(panel).toBeVisible()

    await panel.getByRole("combobox", { name: "Type of column_b" }).click()
    await page.getByRole("option", { name: "currency" }).click()

    // Both files got the same placeholder shape, so apply-to-all has a real
    // second file to reach — matched server-side on the original shape hash.
    await panel.getByRole("button", { name: /Apply to 1 file/ }).click()
    await page.getByRole("button", { name: /Include these 1/ }).click()
    await panel.getByRole("button", { name: "Save" }).click()
    await expect(panel.getByText(/Saved to 2 files/)).toBeVisible()

    // ── PAST THE GATE ─────────────────────────────────────────────────────
    await page.getByRole("button", { name: /^Convert/ }).click()

    // The convert worker claims each file under a lease, writes result.txt and
    // marks its tables DONE. Two tables, so "2 of 2 done".
    await expect(status(page)).toHaveText(/2 of 2 done/, { timeout: 60_000 })

    // A finished table opens immediately — that link exists only because the
    // result poll reported this table DONE.
    await page.getByRole("link", { name: /View/ }).first().click()

    // A REAL schema id, written by the worker and carried all the way into the
    // URL. That is the part this test can prove.
    await expect(page).toHaveURL(/\/t\/sch_/)

    // The rows come from the in-app fixture — there is no rows endpoint yet
    // (§0.9) — so the counts here are the fixture's, not the placeholder
    // schema's. Assert that a table rendered, not what is in it.
    await expect(page.getByText(/\d+ rows · \d+ fields/)).toBeVisible()
  })
})

test.describe("the gate", () => {
  test("a disabled Convert says what would enable it", async ({ page }) => {
    // Straight after the drop the worker has not finished, so the server's own
    // `convertBlockedReason` is what the screen shows — computed by
    // /api/polling/schema, not asserted into existence here.
    await dropFiles(page, [pdf("invoice-1043.pdf")])

    const convert = page.getByRole("button", { name: /^Convert/ })
    if (await convert.isDisabled()) {
      await expect(
        page.getByText(/still reading (its|their) shape|still uploading/).first(),
      ).toBeVisible()
    }

    // And it opens once the worker settles it.
    await waitForSchemas(page, 1)
    await expect(convert).toBeEnabled()
  })

  test("a file the worker cannot read does not block Convert", async ({ page }) => {
    await dropFiles(page, [pdf("invoice-1043.pdf"), lyingPdf("scan-0091.pdf")])

    // The worker sniffs magic bytes and settles it FAILED / format_corrupt.
    // Nothing in the browser could have known this.
    await expect(page.getByText(/won't convert/)).toBeVisible({ timeout: 30_000 })
    // The detail the worker wrote, which proves it read the bytes rather than
    // trusting the extension.
    await expect(page.getByText(/but is actually application\/zip/)).toBeVisible()

    // Settled means ready OR failed. One bad file must not hold the good one.
    await expect(page.getByRole("button", { name: /^Convert/ })).toBeEnabled()
  })

  test("a file the browser can reject never reaches the server", async ({ page }) => {
    // An empty file is refused in the drop zone, before a transfer. Different
    // path, different copy — and no request row is created for it at all.
    await dropFiles(page, [
      pdf("invoice-1043.pdf"),
      { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) },
    ])

    await expect(page.getByText(/1 rejected/)).toBeVisible()
    await expect(page.getByText("This file is empty.")).toBeVisible()
    await waitForSchemas(page, 1)
    await expect(page.getByRole("button", { name: /^Convert/ })).toBeEnabled()
  })
})

test.describe("the pause", () => {
  // Nothing in this phase spends an allowance, so no request can reach PAUSED
  // against the real stack. The screen is covered by unit tests; this becomes
  // a real end-to-end check when the extraction engine starts metering.
  test.fixme("a quota pause reads as a pause with a time", async () => {})
})

test.describe("the pages that should almost never appear", () => {
  test("a link that goes nowhere offers a way back", async ({ page }) => {
    await page.goto("/nothing-here")
    await expect(page.getByText("That link doesn't go anywhere")).toBeVisible()
    await page.getByRole("link", { name: "Back to your workspace" }).click()
    await expect(page).toHaveURL("/")
  })
})
