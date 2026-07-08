import Link from "next/link";

const customerTools = [
  { name: "Client List", icon: "👥", description: "View and search all customers." },
  { name: "Client Codes", icon: "🏷️", description: "Identify each customer with a unique code." },
  { name: "Upcoming\nAppointments", icon: "📅", description: "See future bookings linked to customers." },
  { name: "Pending\nBalances", icon: "💳", description: "See what customers still owe." },
  { name: "Customer\nHistory", icon: "🕘", description: "Recent appointments, invoices and messages." },
  { name: "Notes", icon: "📝", description: "Important notes about each customer." },
];

export default function CustomersPage() {
  return (
    <main className="min-h-screen bg-[#151515] text-zinc-100">
      <header className="border-b border-[#d6a735]/40 px-10 py-6">
        <Link href="/" className="text-sm font-semibold text-[#d6a735] hover:underline">
          ← Back to Business Hub
        </Link>

        <div className="mt-6 flex items-end justify-between">
          <div>
            <p className="text-sm font-semibold tracking-[0.35em] text-[#d6a735]">
              BDB OS
            </p>
            <h1 className="mt-3 text-4xl font-bold text-[#d6a735]">
              Customers
            </h1>
            <p className="mt-3 max-w-2xl text-base text-zinc-400">
              Quickly identify customers, track history, appointments, notes and balances.
            </p>
          </div>

          <div className="rounded-2xl border border-[#d6a735]/60 bg-[#202020] px-6 py-4 text-sm font-semibold text-[#d6a735] shadow-[0_0_25px_rgba(214,167,53,0.18)]">
            Customer Identity Workspace
          </div>
        </div>
      </header>

      <section className="mx-auto flex max-w-6xl flex-col items-center px-8 py-10">
        <div className="relative h-[520px] w-[520px] rounded-full border-2 border-[#d6a735]/70 shadow-[0_0_70px_rgba(214,167,53,0.18)]">
          <div className="absolute inset-14 rounded-full border border-dashed border-[#d6a735]/50" />
          <div className="absolute inset-28 rounded-full border border-dotted border-[#d6a735]/35" />

          <div className="absolute left-1/2 top-1/2 z-10 flex h-52 w-52 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border-2 border-[#d6a735] bg-[#202020] text-center shadow-[0_0_45px_rgba(214,167,53,0.4)]">
            <div className="text-4xl">👥</div>
            <h2 className="mt-3 text-2xl font-bold text-[#d6a735]">
              Customers Hub
            </h2>
            <p className="mt-2 max-w-36 text-sm text-zinc-400">
              Every customer. Clearly identified.
            </p>
          </div>

          {customerTools.map((tool, index) => {
            const positions = [
              "top-[-4%] left-1/2 -translate-x-1/2",
              "top-[18%] right-[2%]",
              "bottom-[18%] right-[2%]",
              "bottom-[-4%] left-1/2 -translate-x-1/2",
              "bottom-[18%] left-[2%]",
              "top-[18%] left-[2%]",
            ];

            return (
              <button
                key={tool.name}
                className={`absolute ${positions[index]} z-20 flex h-28 w-28 flex-col items-center justify-center rounded-full border-2 border-[#d6a735] bg-[#202020] text-center shadow-[0_0_30px_rgba(214,167,53,0.32)] transition hover:scale-105 hover:shadow-[0_0_45px_rgba(214,167,53,0.55)]`}
              >
                <span className="text-3xl">{tool.icon}</span>
                <span className="mt-2 whitespace-pre-line text-xs font-bold leading-tight text-zinc-100">
                  {tool.name}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-10 grid w-full grid-cols-3 gap-4">
          {customerTools.map((tool) => (
            <div
              key={tool.name}
              className="rounded-2xl border border-[#d6a735]/35 bg-[#202020] p-5 shadow-[0_0_22px_rgba(214,167,53,0.1)]"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{tool.icon}</span>
                <h3 className="whitespace-pre-line text-lg font-bold leading-tight text-[#d6a735]">
                  {tool.name}
                </h3>
              </div>
              <p className="mt-2 text-sm text-zinc-400">{tool.description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}