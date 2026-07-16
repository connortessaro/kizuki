import type { Metadata } from "next";

const FREE_WAITLIST_URL =
  "mailto:hello@kizuki.dev?subject=Kizuki%20Free%20early%20access";
const CONCIERGE_URL =
  "mailto:hello@kizuki.dev?subject=Kizuki%20concierge%20founding%20cohort";
const PRO_WAITLIST_URL =
  "mailto:hello@kizuki.dev?subject=Kizuki%20Pro%20waitlist";
const TEAM_WAITLIST_URL =
  "mailto:hello@kizuki.dev?subject=Kizuki%20Team%20waitlist";
const ENTERPRISE_URL = "mailto:hello@kizuki.dev?subject=Kizuki%20Enterprise";

const HEADLINE =
  "Kizuki understands what your business, your teams, and your people need.";
const SUBHEAD =
  "It reads your meetings, threads, and tickets to surface what changed, what matters now, and what's missing, then prepares you and your agents to respond. Nothing goes out without you.";
const SECURITY_STRIP = "Local-first. Your infra. We don't want your data.";

export const metadata: Metadata = {
  title: "Kizuki — an intelligence layer over your work",
  description:
    "Kizuki is an agent-neutral intelligence layer over your work. It understands what a business, a team, and a person need — what changed, what matters now, what's missing — and prepares you and your AI agents to respond. Nothing goes out without you.",
  openGraph: {
    title: "Kizuki — an intelligence layer over your work",
    description:
      "One portable understanding your AI agents share: what changed, what matters now, what's missing. You keep authority over every outward action.",
    url: "https://kizuki.dev",
    siteName: "Kizuki",
  },
};

const LOOP_NUMERALS = ["一", "二", "三", "四", "五"];

const LOOP = [
  ["Capture", "Say 'Kizuki this' in any connected chat. The agent distills one decision, learning, hypothesis, or question."],
  ["Validate", "Deterministic code checks identity, provenance, and lifecycle before anything touches disk. The model never writes files."],
  ["Record", "A git-tracked vault of people, projects, and teams, with append-only ledgers for signals and insights."],
  ["Retrieve", "Any connected agent reads and searches the same understanding over MCP instead of asking you to repeat it."],
  ["Advise", "Kizuki surfaces contradictions, stale follow-ups, and evidence gaps, each with a draft ready. It sends nothing."],
];

const REFUSALS = [
  "It never sends. Every outward action is a draft you approve.",
  "It never scores people. It aligns work.",
  "It runs on your machine. The vault is a git repo you own.",
  "Deterministic code owns every durable write.",
];

const SECURITY = [
  "Kizuki runs on your machine and the vault is a git repo you own.",
  "It reads through your agent's own connectors and never widens a source permission.",
  "Local credentials stay local; hosted editions use narrow, encrypted grants. Export or delete your data whenever you want.",
];

type Tier = {
  name: string;
  tag: string;
  price: string;
  body: string;
  cta: string;
  href: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Free",
    tag: "local",
    price: "$0",
    body: "The complete local product for one operator. Bring your own agent and model, use manual or community connectors and Packs, and export everything. Runs on your machine.",
    cta: "Get early access",
    href: FREE_WAITLIST_URL,
  },
  {
    name: "Concierge",
    tag: "beta",
    price: "$49–99/mo",
    body: "A dedicated instance, hands-on onboarding, three to five sources, and a configured Founder or Consultant Pack. Weekly review and direct support.",
    cta: "Join the founding cohort — $49–99/mo",
    href: CONCIERGE_URL,
    featured: true,
  },
  {
    name: "Pro",
    tag: "hosted",
    price: "$29/mo or $290/yr",
    body: "Managed sync, reasoning, connectors, and backups, with remote web and MCP, a model allowance, and premium Packs. Same rules — it still sends nothing without you. In development.",
    cta: "Join the waitlist",
    href: PRO_WAITLIST_URL,
  },
  {
    name: "Team",
    tag: "workspace",
    price: "$25–40 per active user / mo",
    body: "A shared workspace with private and shared evidence, roles, team briefs, and agent and Pack grants. Central billing, with a monthly minimum. In development.",
    cta: "Join the waitlist",
    href: TEAM_WAITLIST_URL,
  },
  {
    name: "Enterprise",
    tag: "custom",
    price: "Custom annual",
    body: "A dedicated or customer-controlled deployment with governance, security, custom connectors, and direct support.",
    cta: "Talk to us",
    href: ENTERPRISE_URL,
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="hero">
        <div className="kanji" aria-hidden="true">
          気<span className="lit-glyph">づ</span>き
        </div>
        <h1>
          Kizuki<span>the noticing</span>
        </h1>
        <p className="one-liner">{HEADLINE}</p>
        <p className="sub">{SUBHEAD}</p>
        <p className="ctas">
          <a className="primary" href={CONCIERGE_URL}>
            Join the founding cohort
          </a>
          <a href="https://demo.kizuki.dev">Live demo</a>
        </p>
        <p className="security-strip">
          {SECURITY_STRIP} <a href="#security">How we handle your data</a>
        </p>
      </header>

      <section>
        <p className="eyebrow">THE GAP</p>
        <p>
          Each chat starts blank. The decision you made with one agent never
          reaches the next. A third drafts a message that contradicts both.
          More agents move work faster and pull it further apart. The context
          that would stop the drift exists. It lives in the chat you closed
          yesterday.
        </p>
      </section>

      <section>
        <p className="eyebrow">HOW IT WORKS</p>
        <ol className="loop">
          {LOOP.map(([name, text], i) => (
            <li key={name}>
              <span className="num" aria-hidden="true">
                {LOOP_NUMERALS[i]}
              </span>
              <strong>{name}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="andon-band">
        <p className="eyebrow">THE NOTICING</p>
        <ul className="andon">
          <li>Sandbox credentials blocked ops since Tuesday.</li>
          <li className="lit">
            Mobile cut guest checkout in standup. Web is still building
            against it.
          </li>
          <li>Perf sits at 520ms against a 400ms budget.</li>
        </ul>
        {/* Reserved: replace synthetic lines with anonymized real catch stories once the gate wave produces them. */}
        <p>
          Kizuki reads your meetings, threads, and tickets, then lights the one
          line you would have missed.
        </p>
      </section>

      <section>
        <p className="eyebrow">WHAT IT REFUSES</p>
        <ul className="refusals">
          {REFUSALS.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>

      <section id="security">
        <p className="eyebrow">SECURITY</p>
        <ul className="refusals">
          {SECURITY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section id="pricing">
        <p className="eyebrow">EDITIONS</p>
        <div className="tiers">
          {TIERS.map((tier) => (
            <div className={tier.featured ? "tier featured" : "tier"} key={tier.name}>
              <h2>
                {tier.name} <span>{tier.tag}</span>
              </h2>
              <p className="price">{tier.price}</p>
              <p>{tier.body}</p>
              <a href={tier.href}>{tier.cta}</a>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="eyebrow">WORKS WITH</p>
        <p>
          MCP server included. Works with Codex, Claude Code, Gemini CLI,
          Cursor, and any OpenAI-compatible API.
        </p>
      </section>

      <footer>
        <img src="/momonga.svg" alt="" width="48" height="48" />
        <p>
          Kizuki 気づき — the noticing ·{" "}
          <a href="https://demo.kizuki.dev">Live demo</a>
        </p>
        <img className="seal" src="/seal-ki.svg" alt="" width="34" height="34" />
      </footer>
    </div>
  );
}
