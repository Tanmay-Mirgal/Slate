import { FAQS } from "@/lib/seo";

/** Server-rendered, native <details> so every answer is in the HTML for crawlers and works without JavaScript. */
export function FaqSection() {
  return (
    <section id="faq" className="py-20 px-6 border-t border-[#2B2B2B]">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold tracking-tight text-white mb-3">Frequently Asked Questions</h2>
          <p className="text-[#808080] text-xs">Everything about Slate, the AI diagram generator and pricing.</p>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group rounded-2xl border border-[#2B2B2B] bg-[#141414] px-5 py-4 open:bg-[#161616]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-white [&::-webkit-details-marker]:hidden">
                <h3 className="text-sm font-semibold text-white">{faq.question}</h3>
                <span aria-hidden className="text-[#808080] transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-[#A0A0A0]">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
