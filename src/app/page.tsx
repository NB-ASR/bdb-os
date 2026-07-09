import Link from "next/link";
const modules = [

  { name: "Accounts", icon: "📁", href: "/accounts", position: "top-[0%] left-1/2 -translate-x-1/2" },
  { name: "Customers", icon: "👥", href: "/customers", position: "top-[15%] right-[8%]" },
  { name: "Comms", icon: "💬", href: "/Communications", position: "top-1/2 right-[0%] -translate-y-1/2" },
  { name: "Calendar", icon: "📅", href: "/calendar", position: "bottom-[15%] right-[8%]" },
  { name: "Automation Hub", icon: "✧", href: "/automation-hub", position: "bottom-[0%] left-1/2 -translate-x-1/2" },
  { name: "Documents", icon: "📄", href: "/documents", position: "bottom-[15%] left-[8%]" },
  { name: "Banking", icon: "🏦", href: "/banking", position: "top-1/2 left-[0%] -translate-y-1/2" },
  { name: "Reports", icon: "📊", href: "/reports", position: "top-[15%] left-[8%]" },
];


const pinned = [
  { name: "Accounts", icon: "📁" },
  { name: "Customers", icon: "👥" },
  { name: "Calendar", icon: "📅" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#151515] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-10 py-8">
        <header className="flex items-center justify-between border-b border-[#8a651f]/40 pb-7">
          <div>
            <p className="text-5xl font-black tracking-tight text-[#d6a735]">
              BDB OS
            </p>
            <p className="mt-2 font-serif text-lg italic text-[#d6a735] opacity-80">
              Buontempo · Demicoli · Bianchini
            </p>
            <h1 className="mt-5 text-4xl font-light tracking-[0.08em] text-zinc-100">
              Business Hub
            </h1>
          </div>

          <div className="rounded-2xl border-2 border-[#d6a735] bg-[#202020] px-10 py-5 text-xl font-bold tracking-wide text-[#d6a735] shadow-[0_0_30px_rgba(214,167,53,0.45)]">
            BUSINESS. DONE. BETTER.
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center py-8">
          <div className="relative h-[720px] w-[720px] rounded-full border-2 border-[#b88a28] shadow-[0_0_90px_rgba(214,167,53,0.2)]">
            <div className="absolute inset-20 rounded-full border border-dashed border-[#b88a28]/70" />
            <div className="absolute inset-36 rounded-full border border-dotted border-[#b88a28]/50" />

            <div className="absolute left-1/2 top-1/2 z-10 flex h-80 w-80 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-4 border-[#d6a735] bg-[#1e1e1e] text-center shadow-[0_0_60px_rgba(214,167,53,0.55)]">
              <div className="absolute inset-4 rounded-full border border-[#d6a735]/35" />

              <div className="absolute top-16 text-4xl font-light tracking-[0.25em] text-[#d6a735]">
                BDB
              </div>

              <div className="absolute top-28 text-sm font-semibold tracking-[0.35em] text-[#d6a735]">
                BUSINESS OS
              </div>

              <div className="mt-24 px-8 text-xl font-semibold text-zinc-100">
                Your Business Name
              </div>

              <div className="mt-8 text-base text-[#d6a735]">
                Welcome back.
                <br />
                Let&apos;s get things done.
              </div>
            </div>

            {modules.map((module) => (
  <Link
    key={module.name}
    href={module.href}
    className={`absolute ${module.position} z-20 flex h-36 w-36 flex-col items-center justify-center rounded-full border-4 border-[#d6a735] bg-[#202020] text-center shadow-[0_0_35px_rgba(214,167,53,0.45)] transition hover:scale-105 hover:shadow-[0_0_55px_rgba(214,167,53,0.7)]`}
  >
    <span className="text-4xl text-[#d6a735]">{module.icon}</span>
    <span className="mt-3 text-base font-bold text-zinc-100">
      {module.name}
    </span>
  </Link>
))}
          
          </div>
        </section>

        <footer className="mx-auto mb-4 flex items-center gap-8 rounded-3xl border border-[#d6a735]/60 bg-[#202020] px-10 py-6 shadow-[0_0_35px_rgba(214,167,53,0.18)]">
          <div className="flex items-center gap-3 border-r border-[#d6a735]/50 pr-8 text-xl font-bold text-[#d6a735]">
            <span>📌</span>
            <span>PINNED</span>
          </div>

          {pinned.map((item) => (
            <button
              key={item.name}
              className="flex items-center gap-4 rounded-2xl border border-[#d6a735]/70 bg-[#1a1a1a] px-7 py-4 text-lg font-medium text-zinc-100 transition hover:border-[#d6a735] hover:bg-[#2a2415]"
            >
              <span className="text-[#d6a735]">{item.icon}</span>
              <span>{item.name}</span>
              <span className="text-[#d6a735]">★</span>
            </button>
          ))}
        </footer>
      </div>
    </main>
  );
}