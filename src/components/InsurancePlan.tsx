import { ArrowRight, Brain, Broadcast, Buildings, Circuitry, Factory, FirstAidKit, HouseLine, ShieldCheck, UserCircleGear } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const sourceSignals = [
  {
    label: 'Compute becomes a public risk object',
    proof: '@peterxing feed, Jun 11',
    href: 'https://x.com/peterxing/status/2064890574151594015',
    detail: 'The "let them eat compute" signal points to unequal intelligence access as a new household, firm and policy exposure.',
  },
  {
    label: 'Business change is system change',
    proof: 'Microsoft blog share, Jun 4',
    href: 'https://x.com/peterxing/status/2062642750139596961',
    detail: 'AI value sits in the operating system around the model: workflow traces, permissions, data, audit and accountability.',
  },
  {
    label: 'Regional resilience is already visible',
    proof: 'Starlink regional NSW posts, May 30 and Jun 10',
    href: 'https://x.com/peterxing/status/2064542381958177239',
    detail: 'Connectivity, installers, backup comms and site uptime are now practical underwriting facts, not background assumptions.',
  },
  {
    label: 'Longevity and bio become actuarial shocks',
    proof: 'Recent repost/bookmark signal, Jun 15',
    href: 'https://x.com/kimmonismus/status/2066451429003239475',
    detail: 'Cellular senescence mapping, AI biology and neurotechnology shift life, health, disability and care models.',
  },
  {
    label: 'Factories, robots and energy stack together',
    proof: 'Tesla/SpaceX infrastructure reposts, Jun 15',
    href: 'https://x.com/herbertong/status/2066512135094751480',
    detail: 'AI chips, factories, robots, power and logistics create correlated infrastructure risk and correlated productivity upside.',
  },
  {
    label: 'Local models create sovereignty exposure',
    proof: 'Local LLM repost, Jun 14',
    href: 'https://x.com/TraffAlex/status/2066236717015728227',
    detail: 'Consumer GPU and local LLM adoption makes cyber, model governance and offline continuity mainstream insurance topics.',
  },
];

const coverageMap = [
  {
    category: 'Life, longevity and annuity',
    buyer: 'Insurers, individuals, super funds',
    signal: 'Longevity, cellular senescence, Neuralink and NewLimit interest.',
    shift: 'Mortality tables and retirement assumptions become unstable as diagnostics and healthspan tools arrive unevenly.',
    plan: 'Separate mortality, morbidity and longevity-upside products. Add consented biomarker updates, clear anti-discrimination rules and annuity stress tests.',
    urgency: 'High',
  },
  {
    category: 'Health, disability and income protection',
    buyer: 'Individuals, employers, health systems',
    signal: 'AI biology plus work automation creates both better prevention and faster income disruption.',
    shift: 'The main claim may move from injury or illness to delayed diagnosis, model error, care access or skill obsolescence.',
    plan: 'Bundle prevention, AI second opinions, mental health, retraining cover and transparent human appeal paths for AI-assisted decisions.',
    urgency: 'High',
  },
  {
    category: 'Home, property and climate',
    buyer: 'Households, landlords, lenders',
    signal: 'Post-AGI planning stack: shelter, energy, water, comms, tools and local resilience.',
    shift: 'Property risk is no longer just fire, flood and theft. It includes grid outage, comms outage, sensor quality and local supply fragility.',
    plan: 'Map each site for power, water, connectivity, security, repair access and evacuation. Reward verified hardening with lower excess or resilience credits.',
    urgency: 'High',
  },
  {
    category: 'Facility, infrastructure and microgrid',
    buyer: 'Facilities, farms, councils, campuses',
    signal: 'Starlink regional demand, energy/compute posts and microgrid planning.',
    shift: 'Facilities become live systems: solar, batteries, inverters, network links, robots, access control and occupancy all change loss probability.',
    plan: 'Create a facility risk ledger that links power quality, network uptime, robot zones, maintenance proof and emergency operating modes.',
    urgency: 'Immediate',
  },
  {
    category: 'Compute, AI service and cloud continuity',
    buyer: 'Insurers, businesses, public agencies',
    signal: 'Compute scarcity, data center scale and local LLM sovereignty.',
    shift: 'Intelligence access becomes operational continuity. Model/API downtime can be as damaging as power outage or supplier failure.',
    plan: 'Add parametric cover for critical AI service downtime, fallback model readiness, data export rights and offline operating procedures.',
    urgency: 'Immediate',
  },
  {
    category: 'Cyber, data and model risk',
    buyer: 'Everyone with agents, data or payments',
    signal: 'Local LLM adoption and agentic business systems.',
    shift: 'Cyber expands from network intrusion to prompt injection, agent overreach, model poisoning, identity abuse and automated payment mistakes.',
    plan: 'Underwrite agent permissions, tool logs, model provenance, identity controls, backup keys, payment limits and incident replay capability.',
    urgency: 'Immediate',
  },
  {
    category: 'Professional liability and AI E&O',
    buyer: 'Advisers, software firms, clinics, consultants',
    signal: 'AI business system posts and the book thesis on workflow automation.',
    shift: 'Liability shifts from one human judgment call to a chain of model, prompt, tool, data, review and approval decisions.',
    plan: 'Require decision traces, human escalation thresholds, versioned prompts, source citations and clear responsibility between vendor, operator and reviewer.',
    urgency: 'High',
  },
  {
    category: 'Directors, officers and governance',
    buyer: 'Boards, DAOs, nonprofits, public bodies',
    signal: 'Systems, sovereignty and public legitimacy themes.',
    shift: 'Boards can be liable for both reckless AI deployment and reckless refusal to modernize when systems become safer and cheaper.',
    plan: 'Add AI risk to the board register: model inventory, vendor dependency, human approval gates, social licence and catastrophic correlation exposure.',
    urgency: 'High',
  },
  {
    category: 'Business interruption and supply chain',
    buyer: 'Businesses, logistics, manufacturers',
    signal: 'Tesla factory expansion, SpaceX scale and AI workflow systems.',
    shift: 'Interruption can come from model outages, chip shortages, robot downtime, energy bottlenecks, compliance freezes or vendor lock-in.',
    plan: 'Model business interruption by workflow, not department. Track which decisions stop when a model, grid, robot, network or vendor fails.',
    urgency: 'High',
  },
  {
    category: 'Workers comp, labour transition and education',
    buyer: 'Employers, schools, unions, governments',
    signal: 'Higher-ed margin-call repost and work-after-work chapter signals.',
    shift: 'Work risk includes deskilling, apprenticeship collapse, unsafe human-machine handoff and stress from rapid role compression.',
    plan: 'Bundle physical safety, mental health, retraining, verified AI fluency and human-machine incident reporting into workforce cover.',
    urgency: 'Medium',
  },
  {
    category: 'Mobility, fleet and autonomous systems',
    buyer: 'Households, fleets, facilities, councils',
    signal: 'Tesla, robots, manufacturing and autonomy-adjacent feed signals.',
    shift: 'Risk moves from driver behavior to software version, sensor maintenance, geofence quality, remote intervention and charging resilience.',
    plan: 'Underwrite fleet telemetry, software update policy, charging backup, remote operator logs and liability split between owner, vendor and operator.',
    urgency: 'Medium',
  },
  {
    category: 'Agriculture, food, water and biosecurity',
    buyer: 'Farms, food processors, councils, households',
    signal: 'Post-AGI resilience stack plus farm automation and regional comms context.',
    shift: 'Food and water risk becomes a sensor, robotics, energy, weather, disease and logistics portfolio rather than a narrow crop policy.',
    plan: 'Cover verified telemetry, irrigation uptime, cold-chain continuity, biosecurity monitoring, robot safety and alternate route plans.',
    urgency: 'Medium',
  },
  {
    category: 'Event, community and public liability',
    buyer: 'Venues, meetups, schools, communities',
    signal: 'AI Singularity Syndicate event posts and local community planning.',
    shift: 'Events increasingly rely on AI coordination, identity, payments, comms, crowd management and emergency response tooling.',
    plan: 'Add AI-assisted operations checks, comms fallback, identity/payment fraud controls, evacuation proof and explicit AI-generated content liability terms.',
    urgency: 'Medium',
  },
  {
    category: 'Environmental, political and catastrophe',
    buyer: 'Governments, reinsurers, infrastructure owners',
    signal: 'Abundance, energy and "moving forward" environmental reposts.',
    shift: 'Catastrophe risk is more correlated when climate, energy, cyber, social trust and AI systems fail together.',
    plan: 'Use scenario layers: climate event, grid stress, comms failure, misinformation, model outage, civil disruption and supply lockup.',
    urgency: 'High',
  },
];

const stakeholderPlans = [
  {
    title: 'Insurers',
    icon: ShieldCheck,
    moves: [
      'Publish an AGI coverage taxonomy: agent liability, model error, compute outage, robot incident, bio/longevity shift and facility autonomy.',
      'Move underwriting from annual forms to consented live evidence: power, comms, telemetry, controls, governance and incident traces.',
      'Create parametric products for downtime, compute access, grid outage, emergency comms and verified facility hardening.',
      'Hold explicit correlation reserves for common model vendors, cloud providers, chip supply, cyber events and energy bottlenecks.',
    ],
  },
  {
    title: 'Individuals',
    icon: UserCircleGear,
    moves: [
      'Review life, health, disability, income, cyber, home and vehicle policies for AI, robot, model, platform and biometric-data exclusions.',
      'Keep a household resilience file: power backup, Starlink or alternate comms, identity recovery, key documents, health baseline and local helpers.',
      'Treat healthspan as financial risk management: diagnostics, sleep, muscle, preventive care, mental health and AI-assisted second opinions.',
      'Avoid single points of failure in work: one employer, one platform, one AI tool, one bank, one device, one cloud identity.',
    ],
  },
  {
    title: 'Facilities',
    icon: Buildings,
    moves: [
      'Build a live site ledger for power, network, access control, cameras, water, fire, robots, charging, occupancy and evacuation.',
      'Separate ordinary property cover from operational resilience cover for microgrids, batteries, inverters, Starlink, sensors and local compute.',
      'Run quarterly human-machine safety drills for robots, gates, tools, alarms, delivery zones and remote operators.',
      'Use verified maintenance logs and uptime telemetry to negotiate lower excess, better limits or parametric downtime cover.',
    ],
  },
  {
    title: 'Businesses',
    icon: Factory,
    moves: [
      'Map every AI workflow that touches customers, money, contracts, safety, regulated advice, hiring, medical data or production systems.',
      'Record who is accountable at each step: model vendor, tool vendor, operator, reviewer, manager and board.',
      'Buy or update cyber, E&O, D&O, business interruption, product liability, workers comp and key-person cover around actual AI workflows.',
      'Design fallback modes: human review, alternate model, offline process, alternate supplier and manual customer communication.',
    ],
  },
  {
    title: 'Other organisations',
    icon: Broadcast,
    moves: [
      'For councils, schools, hospitals, charities and associations, define critical services that must survive model, power, comms and trust failures.',
      'Use insurance procurement to force better evidence: incident drills, data governance, vendor resilience, local comms and public appeal channels.',
      'Create mutual-aid and community-risk pools for events that commercial insurers exclude or price too late.',
      'Make AI access, health access, emergency comms and trusted local coordination part of the risk plan, not optional innovation theatre.',
    ],
  },
];

const implementationSteps = [
  {
    time: 'Days 0-30',
    title: 'Inventory the actual risk surface',
    tasks: 'List all policies, exclusions, AI systems, agents, vendors, energy dependencies, comms dependencies, facility assets and biometric or identity stores.',
  },
  {
    time: 'Days 31-60',
    title: 'Pilot evidence-based cover',
    tasks: 'Choose one facility or business process and attach telemetry, logs, human approval gates, backup procedures and incident replay to underwriting.',
  },
  {
    time: 'Days 61-90',
    title: 'Build the board or household decision pack',
    tasks: 'Produce a one-page exposure map, top ten uninsured AGI-era risks, current mitigations, cover gaps, renewal asks and no-regrets upgrades.',
  },
  {
    time: 'Months 4-12',
    title: 'Move from claims to prevention',
    tasks: 'Negotiate resilience credits, parametric downtime triggers, cyber/model incident rehearsal, longevity-prevention incentives and shared-risk pools.',
  },
];

function SignalIcon({ index }: { index: number }) {
  const icons = [Circuitry, Brain, Broadcast, FirstAidKit, Factory, HouseLine];
  const Icon = icons[index % icons.length];
  return <Icon size={22} weight="duotone" className="text-[oklch(0.48_0.16_210)]" />;
}

export function InsurancePlan() {
  return (
    <main className="min-h-screen bg-[oklch(0.98_0.01_210)] text-[oklch(0.18_0.03_245)]">
      <section className="border-b border-[oklch(0.85_0.03_230)] bg-[linear-gradient(135deg,oklch(0.99_0.005_210),oklch(0.94_0.04_180)_52%,oklch(0.96_0.05_80))]">
        <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <nav className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <a href="/" className="inline-flex items-center gap-2 font-semibold text-[oklch(0.24_0.06_245)]">
              <Brain size={22} weight="duotone" />
              Rehoboam
            </a>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="border-[oklch(0.74_0.06_220)] bg-white/70 text-[oklch(0.24_0.05_245)]">
                <a href="/book">Read Book</a>
              </Button>
              <Button asChild size="sm" className="bg-[oklch(0.26_0.07_245)] text-white hover:bg-[oklch(0.32_0.09_245)]">
                <a href="#category-map">
                  Open Map
                  <ArrowRight size={16} />
                </a>
              </Button>
            </div>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div className="space-y-6">
              <div className="inline-flex w-fit items-center rounded-md border border-[oklch(0.75_0.08_165)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[oklch(0.36_0.11_165)]">
                Post-AGI insurance plan / June 2026
              </div>
              <div className="max-w-4xl space-y-4">
                <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl">
                  Insurance becomes the operating system for post-AGI risk.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-[oklch(0.33_0.03_245)] sm:text-lg">
                  The old model prices yesterday's loss. The post-AGI model proves prevention, resilience and accountability across intelligence, energy, compute, biology, robotics, facilities and public trust.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium text-[oklch(0.28_0.04_245)]">
                {['From claims to prevention', 'From assets to systems', 'From annual forms to live evidence', 'From single-risk to correlated-risk'].map((item) => (
                  <span key={item} className="rounded-md border border-[oklch(0.82_0.04_220)] bg-white/75 px-3 py-2">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div aria-label="Post-AGI insurance stack" className="grid gap-2 rounded-lg border border-[oklch(0.76_0.05_220)] bg-white/75 p-3 shadow-sm">
              {[
                ['Human stack', 'life, health, income, care'],
                ['Operating stack', 'agents, models, data, vendors'],
                ['Facility stack', 'power, comms, robots, access'],
                ['Public stack', 'trust, climate, social licence'],
              ].map(([layer, detail], index) => (
                <div key={layer} className="grid grid-cols-[110px_1fr] items-center gap-3 rounded-md border border-[oklch(0.88_0.03_220)] bg-[oklch(0.99_0.004_210)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.08_210)]">{layer}</div>
                  <div className="h-3 rounded-full bg-[oklch(0.86_0.04_220)]">
                    <div
                      className="h-3 rounded-full"
                      style={{
                        width: `${92 - index * 13}%`,
                        background: ['oklch(0.63 0.15 165)', 'oklch(0.60 0.17 230)', 'oklch(0.70 0.16 75)', 'oklch(0.58 0.18 25)'][index],
                      }}
                    />
                  </div>
                  <div className="col-span-2 text-xs text-[oklch(0.39_0.03_245)]">{detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" id="signals">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.09_165)]">Source signal map</p>
            <h2 className="text-2xl font-bold">Feed and thread signals translated into insurance moves</h2>
          </div>
          <a className="text-sm font-medium text-[oklch(0.38_0.13_220)] hover:underline" href="https://chatgpt.com/share/6a3083ae-e5f4-83e8-a0b7-d183711e6182">
            Shared thread: Insurance Disruption by AGI
          </a>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sourceSignals.map((signal, index) => (
            <a
              key={signal.label}
              href={signal.href}
              className="group rounded-lg border border-[oklch(0.86_0.03_220)] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[oklch(0.64_0.11_210)] hover:shadow-md"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <SignalIcon index={index} />
                <span className="rounded-md bg-[oklch(0.94_0.04_165)] px-2 py-1 text-[11px] font-semibold text-[oklch(0.38_0.10_165)]">{signal.proof}</span>
              </div>
              <h3 className="text-base font-semibold group-hover:text-[oklch(0.36_0.13_220)]">{signal.label}</h3>
              <p className="mt-2 text-sm leading-6 text-[oklch(0.39_0.03_245)]">{signal.detail}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" id="category-map">
        <div className="mb-5 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.09_165)]">Category map</p>
          <h2 className="text-2xl font-bold">Every major insurance line gets a post-AGI interpretation</h2>
          <p className="mt-2 text-sm leading-6 text-[oklch(0.39_0.03_245)]">
            Use this as the working taxonomy for renewals, new products, board risk registers and household cover reviews.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {coverageMap.map((item) => (
            <Card key={item.category} className="gap-4 rounded-lg border-[oklch(0.86_0.03_220)] bg-white p-5 py-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{item.category}</h3>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[oklch(0.42_0.08_210)]">{item.buyer}</p>
                </div>
                <span className="w-fit rounded-md border border-[oklch(0.82_0.05_70)] bg-[oklch(0.96_0.06_82)] px-2.5 py-1 text-xs font-semibold text-[oklch(0.37_0.10_70)]">
                  {item.urgency}
                </span>
              </div>
              <div className="grid gap-3 text-sm leading-6 md:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.52_0.04_245)]">Signal</p>
                  <p className="mt-1 text-[oklch(0.35_0.03_245)]">{item.signal}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.52_0.04_245)]">AGI shift</p>
                  <p className="mt-1 text-[oklch(0.35_0.03_245)]">{item.shift}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.52_0.04_245)]">Plan</p>
                  <p className="mt-1 text-[oklch(0.35_0.03_245)]">{item.plan}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-y border-[oklch(0.86_0.03_220)] bg-[oklch(0.94_0.02_210)]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-5 max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.09_165)]">Stakeholder plans</p>
            <h2 className="text-2xl font-bold">What each buyer should do now</h2>
          </div>
          <div className="grid gap-3 lg:grid-cols-5">
            {stakeholderPlans.map((plan) => {
              const Icon = plan.icon;
              return (
                <Card key={plan.title} className="rounded-lg border-[oklch(0.82_0.03_220)] bg-white p-4 py-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Icon size={24} weight="duotone" className="text-[oklch(0.44_0.13_220)]" />
                    <h3 className="font-semibold">{plan.title}</h3>
                  </div>
                  <ul className="space-y-3 text-sm leading-6 text-[oklch(0.35_0.03_245)]">
                    {plan.moves.map((move) => (
                      <li key={move} className="border-t border-[oklch(0.90_0.02_220)] pt-3">
                        {move}
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" id="execution">
        <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.09_165)]">Execution board</p>
            <h2 className="mt-1 text-2xl font-bold">The 90-day post-AGI insurance sprint</h2>
            <p className="mt-3 text-sm leading-6 text-[oklch(0.39_0.03_245)]">
              The practical move is not waiting for perfect AGI consensus. It is building policies and operations that can update as the risk surface changes.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {implementationSteps.map((step) => (
              <div key={step.time} className="rounded-lg border border-[oklch(0.84_0.03_220)] bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-[oklch(0.42_0.10_165)]">{step.time}</p>
                <h3 className="mt-2 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[oklch(0.35_0.03_245)]">{step.tasks}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-[oklch(0.86_0.03_220)] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm text-[oklch(0.39_0.03_245)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Built for post-AGI planning: insurance as prevention, resilience and accountable agency.</p>
          <div className="flex flex-wrap gap-3">
            <a className="font-medium text-[oklch(0.36_0.13_220)] hover:underline" href="/">Timeline planner</a>
            <a className="font-medium text-[oklch(0.36_0.13_220)] hover:underline" href="/book">Book</a>
            <a className="font-medium text-[oklch(0.36_0.13_220)] hover:underline" href="#signals">Signals</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
