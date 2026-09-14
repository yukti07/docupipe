import { ErrorState } from "@/components/common/ErrorState"

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <ErrorState
        title="That link doesn't go anywhere"
        body="The batch may never have existed in this browser, or the address has a typo in it. Your workspace is where you left it."
        backHref="/"
      />
    </main>
  )
}
