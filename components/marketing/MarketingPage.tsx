import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { FaqSection } from "@/components/landing/FaqSection";
import { MARKETING_PAGES, marketingPageBySlug, type MarketingPage as PageData } from "@/lib/marketing-pages";

const SIGN_UP = "/auth?mode=sign-up";
const primaryCta =
  "inline-flex h-12 items-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-black shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-transform hover:scale-105";
const secondaryCta =
  "inline-flex h-12 items-center gap-2 rounded-full border border-white/10 bg-black/40 px-8 text-sm font-semibold text-[#E0E0E0] transition-colors hover:bg-white/5 hover:text-white";

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#2B2B2B] bg-[#0A0A0A]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/icons/icon-192.png" alt="Slate logo" width={26} height={26} className="rounded-lg" />
          <span className="text-base font-bold tracking-tight text-white">SLATE</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 text-xs font-semibold text-[#C5C5C5] md:flex">
          <Link href="/#features" className="transition-colors hover:text-white">Features</Link>
          <Link href="/#pricing" className="transition-colors hover:text-white">Pricing</Link>
          <Link href="/playground" className="transition-colors hover:text-white">Playground</Link>
        </nav>
        <div className="flex items-center gap-3 text-xs font-semibold">
          <Link href="/auth?mode=sign-in" className="hidden rounded-xl border border-[#3A3A3A] px-4 py-2.5 text-[#C5C5C5] transition-colors hover:border-white hover:text-white sm:inline-block">
            Log In
          </Link>
          <Link href={SIGN_UP} className="rounded-xl bg-white px-4 py-2.5 text-black transition-colors hover:bg-[#e5e5e5]">
            Sign Up
          </Link>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[#2B2B2B] bg-[#0A0A0A] px-6 py-10 text-xs text-[#808080]">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <Image src="/icons/icon-192.png" alt="" width={18} height={18} className="rounded" />
          <span className="font-bold text-white">SLATE</span>
          <span>© 2026 Slate Inc.</span>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-[#C5C5C5]">
          <Link href="/" className="hover:text-white">Home</Link>
          {MARKETING_PAGES.map((p) => (
            <Link key={p.slug} href={`/${p.slug}`} className="hover:text-white">{p.breadcrumb}</Link>
          ))}
          <Link href="/playground" className="hover:text-white">Free playground</Link>
          <Link href="/auth?mode=sign-in" className="hover:text-white">Log in</Link>
        </nav>
      </div>
    </footer>
  );
}

/** A server-rendered keyword page. All copy comes from lib/marketing-pages.ts. */
export function MarketingPage({ page }: { page: PageData }) {
  const related = page.related.map((slug) => marketingPageBySlug(slug)).filter((p): p is PageData => Boolean(p));

  return (
    <div className="min-h-screen bg-[#0A0A0A] font-sans text-white selection:bg-white/20">
      <SiteHeader />

      <main>
        <section className="relative overflow-hidden px-6 pb-16 pt-16 text-center">
          <div className="pointer-events-none absolute left-1/2 top-1/3 -z-0 h-[320px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-purple-600/20 blur-[120px]" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-center">
            <nav aria-label="Breadcrumb" className="mb-8 text-xs text-[#808080]">
              <ol className="flex items-center gap-2">
                <li><Link href="/" className="hover:text-white">Home</Link></li>
                <li aria-hidden>/</li>
                <li aria-current="page" className="text-[#C5C5C5]">{page.breadcrumb}</li>
              </ol>
            </nav>
            <p className="mb-6 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-[#E0E0E0]">{page.eyebrow}</p>
            <h1 className="max-w-3xl bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-extrabold leading-[1.1] tracking-tight text-transparent md:text-6xl">
              {page.h1}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#A0A0A0]">{page.lede}</p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
              <Link href={SIGN_UP} className={primaryCta}>
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/playground" className={secondaryCta}>Try the playground</Link>
            </div>

            {page.prompts && (
              <ul aria-label="Example prompts" className="mt-8 flex flex-wrap justify-center gap-2">
                {page.prompts.map((p) => (
                  <li key={p} className="rounded-full border border-[#2B2B2B] bg-[#141414] px-3.5 py-1.5 text-xs text-[#C5C5C5]">{p}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="relative mx-auto mt-14 max-w-5xl rounded-2xl border border-white/10 bg-black/60 p-2 shadow-[0_20px_60px_-15px_rgba(0,0,0,1)]">
            <Image
              src="/slate-how-to-poster.jpg"
              alt={page.heroAlt}
              width={1600}
              height={900}
              priority
              sizes="(min-width: 1024px) 1000px, 100vw"
              className="block w-full rounded-xl"
            />
          </div>
        </section>

        <section className="border-t border-[#2B2B2B] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-10 text-center text-2xl font-bold tracking-tight">{page.stepsHeading}</h2>
            <ol className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {page.steps.map((step, i) => (
                <li key={step.title} className="flex gap-4 rounded-2xl border border-[#2B2B2B] bg-[#141414] p-5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-black">{i + 1}</span>
                  <div>
                    <h3 className="text-sm font-bold text-white">{step.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-[#A0A0A0]">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {page.example && (
          <section className="border-t border-[#2B2B2B] px-6 py-20">
            <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">{page.example.heading}</h2>
                <p className="mt-3 text-sm leading-relaxed text-[#A0A0A0]">{page.example.intro}</p>
                <ul className="mt-6 space-y-3">
                  {page.example.result.map((line) => (
                    <li key={line} className="flex items-start gap-2.5 text-xs leading-relaxed text-[#C5C5C5]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
              <figure className="min-w-0">
                <figcaption className="mb-2 font-mono text-xs text-[#808080]">{page.example.filename}</figcaption>
                {/* Scrollable region: focusable so keyboard users can scroll long lines. */}
                <pre tabIndex={0} className="overflow-x-auto rounded-xl border border-[#2B2B2B] bg-[#0D0D0D] p-4 font-mono text-xs leading-relaxed text-[#C5C5C5]">
                  <code>{page.example.code}</code>
                </pre>
              </figure>
            </div>
          </section>
        )}

        <section className="border-t border-[#2B2B2B] px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-10 text-center text-2xl font-bold tracking-tight">{page.featuresHeading}</h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {page.features.map((f) => (
                <div key={f.title} className="space-y-2 rounded-2xl border border-[#2B2B2B] bg-[#141414] p-5">
                  <h3 className="text-sm font-bold text-white">{f.title}</h3>
                  <p className="text-xs leading-relaxed text-[#808080]">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <FaqSection faqs={page.faqs} heading={`${page.breadcrumb}: common questions`} subheading="Straight answers about how it works and what it costs." />

        <section className="border-t border-[#2B2B2B] px-6 py-20 text-center">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">Start with a blank board, or with a prompt</h2>
            <p className="mt-3 text-sm text-[#808080]">The playground needs no account. A free account unlocks AI diagrams, sync and sharing.</p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link href={SIGN_UP} className={primaryCta}>
                Create a free account <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/playground" className={secondaryCta}>Open the playground</Link>
            </div>
          </div>

          {related.length > 0 && (
            <nav aria-label="Related pages" className="mx-auto mt-16 max-w-3xl text-left">
              <h2 className="mb-4 text-sm font-bold text-white">Related</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/${r.slug}`} className="block rounded-2xl border border-[#2B2B2B] bg-[#141414] p-4 transition-colors hover:border-[#3A3A3A]">
                      <span className="text-sm font-semibold text-white">{r.h1}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-[#808080]">{r.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
