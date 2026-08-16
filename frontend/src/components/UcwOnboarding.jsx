export default function UcwOnboarding({ onContinue }) {
  return (
    <section className="card-surface p-8 text-center max-w-md mx-auto" aria-labelledby="ucw-onboarding-title">
      <p className="eyebrow mb-3">Account ready</p>
      <h2 id="ucw-onboarding-title" className="display text-2xl text-ink mb-3">
        Your Tranche account is ready.
      </h2>
      <p className="text-sm text-ink-2 leading-relaxed mb-6">
        Your Circle wallet is linked on Arc Testnet. Continue to the app to
        create or receive milestone escrows.
      </p>
      <button type="button" onClick={onContinue} className="btn-primary text-sm py-2.5 px-5">
        Continue to Tranche
      </button>
    </section>
  )
}
