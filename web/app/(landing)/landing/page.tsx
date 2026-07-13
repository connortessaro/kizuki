import type { Metadata } from "next";

const WAITLIST_URL = "mailto:tessaro.c@northeastern.edu?subject=Kizuki%20Pro%20waitlist";

export const metadata: Metadata = {
  title: "Kizuki — shared memory for your AI agents",
  description:
    "Kizuki holds the facts, decisions, and open questions your AI agents need, so the next session starts where the last one stopped. Nothing goes out without you.",
  openGraph: {
    title: "Kizuki — shared memory for your AI agents",
    description:
      "Your agents share one memory. You keep authority over every outward action.",
    url: "https://kizuki.dev",
    siteName: "Kizuki",
  },
};

const LOOP = [
  ["Capture", "Say 'Kizuki this' in any connected chat. The agent distills one decision, learning, hypothesis, or question."],
  ["Validate", "Deterministic code checks identity, provenance, and lifecycle before anything touches disk. The model never writes files."],
  ["Remember", "A git-tracked vault of people, projects, and teams. Append-only ledgers for signals and insights."],
  ["Retrieve", "Any connected agent searches and reads the same state over MCP instead of asking you to repeat it."],
  ["Advise", "Kizuki surfaces contradictions, stale follow-ups, and evidence gaps, each with a draft ready. It sends nothing."],
];

const REFUSALS = [
  "It never sends. Every outward action is a draft you approve.",
  "It never scores people. It aligns work.",
  "It runs on your machine. The vault is a git repo you own.",
  "Deterministic code owns every durable write.",
];

export default function LandingPage() {
  return (
    <div className="landing">
      <header className="hero">
        <div className="kanji" aria-hidden="true">気づき</div>
        <h1>
          Kizuki<span>the noticing</span>
        </h1>
        <p className="one-liner">Your agents share one memory.</p>
        <p className="sub">
          Kizuki holds the facts, decisions, and open questions your AI agents
          need, so the next session starts where the last one stopped. Nothing
          goes out without you.
        </p>
        <p className="ctas">
          <a href="https://github.com/ctessaro/kizuki">GitHub</a>
          <a href="https://demo.kizuki.dev">Live demo</a>
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
          {LOOP.map(([name, text]) => (
            <li key={name}>
              <strong>{name}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
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

      <section id="pricing">
        <p className="eyebrow">PRICING</p>
        <div className="tiers">
          <div className="tier">
            <h2>Free</h2>
            <p>
              Everything you saw above. The CLI, the vault, the dashboard, the
              MCP server. Runs on your machine. Open source, no account.
            </p>
            <a href="https://github.com/ctessaro/kizuki">GitHub</a>
          </div>
          <div className="tier pro">
            <h2>
              Pro <span>hosted</span>
            </h2>
            <p>
              Kizuki that runs without your laptop: hosted sync, ambient watch,
              same rules. It still sends nothing without you. In development.
            </p>
            <a href={WAITLIST_URL}>Join the waitlist</a>
          </div>
        </div>
      </section>

      <section>
        <p className="eyebrow">RUN IT</p>
        <pre>
          <code>{`git clone https://github.com/ctessaro/kizuki
cd kizuki
./kizuki init
./kizuki doctor
./kizuki start`}</code>
        </pre>
        <p>
          Open source. MCP server included. Works with Codex, Claude Code,
          Gemini CLI, Cursor, and any OpenAI-compatible API.
        </p>
      </section>

      <footer>
        <img src="/momonga.svg" alt="" width="48" height="48" />
        <p>
          Kizuki 気づき — the noticing ·{" "}
          <a href="https://github.com/ctessaro/kizuki">GitHub</a> ·{" "}
          <a href="https://demo.kizuki.dev">Live demo</a>
        </p>
      </footer>
    </div>
  );
}
