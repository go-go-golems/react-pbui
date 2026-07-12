import React from "react";

/* ============================================================
   1 · CONTENT — pure JSON. Swap this object to lay out any
   other verdict-style document with the same system.
   ============================================================ */

const CONTENT = {
  meta: {
    docId: "RESEARCHCTL-005",
    kind: "ANALYSIS",
    date: "2026-07",
    topic: "BAYES / MCMC / UQ",
  },
  thesis: {
    question: "How much would Bayesian analysis / MCMC / PyMC help these studies?",
    display: ["A lot — but only", "at a specific layer."],
    dek:
      "Not on the simulator's own output. The value sits one layer up, where real-world uncertainty actually enters — and getting the layer wrong wastes effort or actively misleads.",
  },
  layers: [
    { id: "L0", tone: "det", name: "Deterministic simulator", gloss: "exact arithmetic — nothing to infer" },
    { id: "L1", tone: "stoch", name: "Parameters & measurement", gloss: "where uncertainty enters" },
    { id: "L2", tone: "stoch", name: "Decisions & verdicts", gloss: "posterior → expected utility" },
  ],
  blocks: [
    {
      type: "distinction",
      title: "The key distinction",
      left: {
        chip: "L0",
        tone: "det",
        heading: "What is exact",
        body:
          "The codesign simulator is deterministic — verified: an identical RunSpec produces identical metrics, content-hashed via configHash. A sweep's output contains no noise to infer.",
        facts: [
          "transfer = ceil(bytes / bandwidth)",
          "compute  = ceil(computeUnits / speed)",
          "ridge    = computeRate / memoryRate",
        ],
      },
      right: {
        chip: "L1",
        tone: "stoch",
        heading: "Where uncertainty enters",
        body:
          "On real hardware the device parameters are not point values. Measured HBM bandwidth varies by access pattern, launch overhead has a distribution, and real kernels don't hit ceil() arithmetic exactly.",
        punch: "Fitting a posterior to the sweep output itself would invent uncertainty that does not exist. Model this layer instead.",
      },
    },
    {
      type: "opportunity",
      index: "01",
      layer: "L1",
      tone: "stoch",
      method: "MCMC / PyMC",
      title: "Calibrate device parameters to real measurements",
      tag: "the big payoff",
      body:
        "speed, bandwidthBytesPerNs and setupNs are free parameters. Given Nsight traces or benchmark runs, Bayesian inference is the correct tool to fit posterior distributions over them, propagating measurement noise. The simulator then becomes a calibrated predictor.",
      payoff: "posterior over p95 latency with honest error bars — currently absent from the studies",
    },
    {
      type: "opportunity",
      index: "02",
      layer: "L1",
      tone: "stoch",
      method: "forward MC — not MCMC",
      title: "Uncertainty propagation",
      tag: "cheaper than you think",
      body:
        "Even without real data: put priors over the device parameters (\u201cthe GPU is somewhere between 18 and 24 units/ns\u201d) and forward-sample through the simulator. This yields uncertainty bands on the existing sweep plots. Plain numpy does it — MCMC is inference, and using it for propagation is the expensive tool for the wrong job.",
      payoff: "uncertainty bands on every sweep, an afternoon of numpy",
    },
    {
      type: "opportunity",
      index: "03",
      layer: "L1",
      tone: "stoch",
      method: "direct MC · MCMC when inferring",
      title: "The genuinely stochastic experiments",
      tag: "RESEARCHCTL-003 extensions",
      body:
        "Several planned experiments introduce real randomness — here probabilistic reasoning is unavoidable. Direct Monte Carlo (sample, run the sim, measure the tail) usually suffices; MCMC/PyMC is right only when inferring a latent from observed data.",
      cases: [
        { id: "E1", name: "Poisson / bursty arrivals", note: "p99 tail latency and goodput are properties of a distribution, not a point" },
        { id: "SD1", name: "Speculative decoding", note: "draft acceptance rate is a random variable; speedup is a function of its distribution" },
        { id: "P4", name: "MoE load imbalance", note: "hot-expert utilization under random routing; the straggler effect is a tail event" },
        { id: "VL", name: "Variable-length workloads", note: "head-of-line blocking severity depends on the request-length distribution" },
      ],
      payoff: "infer the acceptance-rate distribution from accept/reject traces; routing skew from utilization telemetry",
    },
    {
      type: "opportunity",
      index: "04",
      layer: "L2",
      tone: "stoch",
      method: "posterior + utility",
      title: "Decision-theoretic policies & research verdicts",
      tag: "ch19 · E4",
      body:
        "Adaptive batching/parallelism is sequential decision-making under uncertainty: maintain a posterior over current load, choose the batch size maximizing expected utility — a principled replacement for heuristic thresholds (\u201cif util > 80%\u201d). Bayesian model comparison could turn the research graph's qualitative supported/rejected states into posterior probabilities, mapping onto the experiment-lifecycle verdict.",
      payoff: "Thompson sampling over load; verdicts as calibrated posteriors instead of hard thresholds",
    },
    {
      type: "matchTable",
      title: "Match the tool to the question",
      rows: [
        { q: "Propagate known distributions", tool: "forward Monte Carlo (numpy)" },
        { q: "Infer latents from data", tool: "MCMC / PyMC" },
        { q: "Sequential decisions", tool: "posterior + utility · Thompson sampling" },
      ],
      note: "They are not interchangeable.",
    },
    {
      type: "guardrails",
      title: "Honest guardrails",
      items: [
        {
          dont: "Don't fit a Bayesian model to deterministic sweep output.",
          why: "The roofline ridge is exactly computeRate/memoryRate. A posterior on a closed-form relationship implies uncertainty where there is none.",
        },
        {
          dont: "Don't expect NUTS/HMC to work directly.",
          why: "ceil() calls and the discrete event loop make the likelihood a non-differentiable black box. You need a Gaussian-process emulator (Kennedy\u2013O'Hagan discrepancy modeling) or a derivative-free sampler (SMC, ABC). Not a drop-in PyMC model.",
        },
        {
          dont: "Don't apply it before the deterministic baseline is settled.",
          why: "The verify-analytically-then-sweep baseline is correctly the first step; calibration is the second. Bayesian analysis before the relationship is established is premature.",
        },
      ],
    },
    {
      type: "anchors",
      title: "Concrete anchors in the existing catalog",
      cards: [
        {
          id: "D1",
          name: "Disaggregated PD",
          det: "the backlog threshold (service > arrival) is exact — no Bayes needed",
          stoch: "the distribution of p95 under uncertain real GPU bandwidth and arrival jitter is a genuine Bayesian question",
        },
        {
          id: "SD1",
          name: "Speculative decoding",
          det: "speedup formula is known given the acceptance rate",
          stoch: "the acceptance rate is the latent to infer from traces; the speedup posterior follows",
        },
        {
          id: "P4",
          name: "MoE routing",
          det: "balanced-routing cost is computable in closed form",
          stoch: "the load-imbalance distribution is the quantity of interest; the straggler tail is what hurts goodput",
        },
      ],
    },
    {
      type: "recommendation",
      title: "Recommendation",
      steps: [
        {
          when: "NOW",
          effort: "an afternoon · plain numpy",
          what: "Forward-Monte-Carlo uncertainty bands on the sweeps already in the ticket. No PyMC required.",
        },
        {
          when: "NEXT",
          effort: "once real benchmark traces exist",
          what: "Fit device-parameter posteriors with PyMC — wrapping the simulator in a GP emulator first, because of the non-differentiability. Build the stochastic experiments as probabilistic models; reach for MCMC only when inferring a latent from observed data.",
        },
      ],
    },
    {
      type: "summary",
      title: "Turn summary",
      rows: [
        {
          label: "This turn",
          text: "Scoped where Bayesian/MCMC/PyMC would and wouldn't help: not on deterministic simulator output, but on device-parameter calibration, forward-MC propagation, the genuinely stochastic experiments, and Bayesian decision policies. Flagged that non-differentiability blocks NUTS/HMC directly.",
        },
        {
          label: "Session",
          text: "researchctl RESEARCHCTL-005 covers ch9\u201312 + ch15/17/18/19 with validated experiments.",
        },
        {
          label: "Next steps",
          text: "Optionally add a Bayesian/UQ extension section to the RESEARCHCTL-003 doc, or start with forward-MC bands on existing sweeps.",
        },
      ],
    },
  ],
};

/* ============================================================
   2 · DESIGN TOKENS + CSS — one grotesque in two weights,
   one mono, hairline rules, semantic color.
   ============================================================ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;700&family=IBM+Plex+Mono:wght@400&display=swap');

:root {
  --paper: #ffffff;
  --ink: #141414;
  --ash: #6e6e6e;
  --hair: #d8d8d8;
  --ultra: #2438ce;      /* semantic: probabilistic */
  --signal: #e32213;     /* semantic: guardrails only */
  --sans: 'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
  --max: 1120px;
  --gut: 24px;
}

.swx * { margin: 0; padding: 0; box-sizing: border-box; }
.swx {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--sans);
  font-weight: 400;
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.swx b, .swx strong { font-weight: 700; }
.swx .wrap { max-width: var(--max); margin: 0 auto; padding: 0 var(--gut); }

/* grid */
.swx .g {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  column-gap: var(--gut);
}

/* rules */
.swx .rule-2 { border-top: 2px solid var(--ink); }
.swx .rule-1 { border-top: 1px solid var(--hair); }

/* labels & mono */
.swx .lab {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.swx .mono { font-family: var(--mono); font-size: 12.5px; }
.swx .ash { color: var(--ash); }

/* layer / method chips */
.swx .chip {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 7px 2px;
  border: 1px solid var(--ink);
  line-height: 1.2;
  white-space: nowrap;
}
.swx .chip.det   { border-color: var(--ink); color: var(--ink); }
.swx .chip.stoch { border-color: var(--ultra); color: var(--ultra); }
.swx .chip.fill  { background: var(--ultra); border-color: var(--ultra); color: #fff; }
.swx .chip.guard { border-color: var(--signal); color: var(--signal); }
.swx .chip.plain { border-color: var(--hair); color: var(--ash); font-family: var(--mono); letter-spacing: 0.06em; }

/* masthead */
.swx .meta-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 14px 0 12px;
}
.swx .display {
  font-size: clamp(40px, 6.2vw, 72px);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.025em;
  text-transform: uppercase;
  padding: 40px 0 0;
}
.swx .dek {
  font-size: 19px;
  line-height: 1.45;
  max-width: 46ch;
  padding: 22px 0 0;
}
.swx .question {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ash);
  padding-top: 26px;
}
.swx .legend { padding: 26px 0 34px; }
.swx .legend-item { display: flex; align-items: baseline; gap: 10px; padding: 7px 0; }
.swx .legend-item + .legend-item { border-top: 1px solid var(--hair); }
.swx .legend-name { font-weight: 700; font-size: 13px; }
.swx .legend-gloss { font-size: 13px; color: var(--ash); }

/* section header */
.swx .sec-head {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 12px 0 26px;
}
.swx .sec-title { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }

/* distinction */
.swx .dist-col h4 { font-size: 15px; font-weight: 700; padding: 10px 0 8px; }
.swx .dist-col p { max-width: 42ch; }
.swx .facts { list-style: none; padding-top: 16px; }
.swx .facts li {
  font-family: var(--mono); font-size: 12.5px;
  padding: 7px 0; border-top: 1px solid var(--hair);
  white-space: pre;
}
.swx .punch {
  margin-top: 16px; padding: 12px 14px;
  border-left: 2px solid var(--ultra);
  font-weight: 700; max-width: 42ch;
}

/* opportunity */
.swx .opp { padding: 26px 0 30px; }
.swx .opp-index {
  font-size: 34px; font-weight: 700; letter-spacing: -0.02em;
  line-height: 1; color: var(--ink);
}
.swx .opp-tag { font-family: var(--mono); font-size: 11.5px; color: var(--ash); padding-top: 8px; }
.swx .opp-title { font-size: 22px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.15; max-width: 24ch; }
.swx .opp-body { padding-top: 12px; max-width: 62ch; }
.swx .opp-chips { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.swx .payoff {
  display: flex; gap: 10px; align-items: baseline;
  margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--hair);
  font-size: 13.5px;
}
.swx .payoff .lab { color: var(--ultra); flex-shrink: 0; }
.swx .cases { list-style: none; margin-top: 16px; }
.swx .case {
  display: grid; grid-template-columns: 56px 220px 1fr; column-gap: 16px;
  padding: 9px 0; border-top: 1px solid var(--hair);
  font-size: 13.5px; align-items: baseline;
}
.swx .case .cid { font-family: var(--mono); font-size: 12px; color: var(--ultra); font-weight: 400; }
.swx .case .cname { font-weight: 700; }

/* match table */
.swx .mt-row {
  display: grid; grid-template-columns: 1fr 28px 1fr; column-gap: 12px;
  padding: 11px 0; border-top: 1px solid var(--hair); align-items: baseline;
}
.swx .mt-row:last-of-type { border-bottom: 1px solid var(--hair); }
.swx .mt-q { font-weight: 700; }
.swx .mt-arrow { color: var(--ash); text-align: center; }
.swx .mt-tool { font-family: var(--mono); font-size: 12.5px; }
.swx .mt-note { padding-top: 10px; font-size: 13px; color: var(--ash); }

/* guardrails */
.swx .guard-item {
  border-left: 3px solid var(--signal);
  padding: 4px 0 4px 18px;
  margin-bottom: 22px;
}
.swx .guard-item:last-child { margin-bottom: 0; }
.swx .guard-dont { font-weight: 700; font-size: 16px; color: var(--signal); }
.swx .guard-why { padding-top: 6px; max-width: 66ch; }

/* anchors */
.swx .anchor { padding: 0 0 8px; }
.swx .anchor-head { display: flex; align-items: baseline; gap: 10px; padding: 12px 0 12px; }
.swx .anchor-name { font-weight: 700; font-size: 15px; }
.swx .anchor-row { padding: 9px 0; border-top: 1px solid var(--hair); font-size: 13.5px; }
.swx .anchor-row .lab { display: block; padding-bottom: 3px; }
.swx .anchor-row.det .lab { color: var(--ink); }
.swx .anchor-row.stoch .lab { color: var(--ultra); }

/* recommendation */
.swx .step { padding: 18px 0 22px; }
.swx .step + .step { border-top: 1px solid var(--hair); }
.swx .step-when { font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1; }
.swx .step-effort { font-family: var(--mono); font-size: 11.5px; color: var(--ash); padding-top: 8px; }
.swx .step-what { max-width: 62ch; }

/* summary footer */
.swx .summary { background: var(--ink); color: #fff; margin-top: 56px; }
.swx .summary .lab { color: #9a9a9a; }
.swx .sum-row { padding: 14px 0; border-top: 1px solid #3a3a3a; }
.swx .sum-row:first-of-type { border-top: none; }
.swx .sum-text { padding-top: 4px; max-width: 88ch; font-size: 13.5px; color: #e6e6e6; }

.swx .section { padding: 34px 0 40px; }

/* responsive */
@media (max-width: 760px) {
  .swx .g { grid-template-columns: 1fr; row-gap: 18px; }
  .swx .opp-chips { flex-direction: row; align-items: center; }
  .swx .case { grid-template-columns: 48px 1fr; }
  .swx .case .cnote { grid-column: 2; color: var(--ash); }
  .swx .mt-row { grid-template-columns: 1fr; row-gap: 4px; }
  .swx .mt-arrow { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .swx * { transition: none !important; }
}
`;

/* ============================================================
   3 · PRIMITIVES
   ============================================================ */

const Chip = ({ tone = "det", children }) => (
  <span className={`chip ${tone}`}>{children}</span>
);

const SectionHead = ({ title, right }) => (
  <div className="rule-2">
    <div className="sec-head">
      <h3 className="sec-title">{title}</h3>
      {right && <span className="lab ash">{right}</span>}
    </div>
  </div>
);

const Col = ({ span, start, children, style }) => (
  <div
    style={{
      gridColumn: start ? `${start} / span ${span}` : `span ${span}`,
      ...style,
    }}
  >
    {children}
  </div>
);

/* ============================================================
   4 · BLOCK COMPONENTS — one per content block type
   ============================================================ */

const Masthead = ({ meta, thesis, layers }) => (
  <header>
    <div className="rule-2" />
    <div className="meta-row">
      <span className="lab">
        {meta.docId} · {meta.kind}
      </span>
      <span className="lab ash">
        {meta.date} · {meta.topic}
      </span>
    </div>
    <div className="rule-1" />
    <div className="g">
      <Col span={9}>
        <h1 className="display">
          {thesis.display.map((line, i) => (
            <React.Fragment key={i}>
              {line}
              <br />
            </React.Fragment>
          ))}
        </h1>
        <p className="dek">
          <strong>Not on the simulator's own output. </strong>
          {thesis.dek.replace("Not on the simulator's own output. ", "")}
        </p>
        <p className="question">Q — {thesis.question}</p>
      </Col>
      <Col span={3}>
        <div className="legend">
          <div className="lab ash" style={{ paddingBottom: 10 }}>
            Layer index
          </div>
          {layers.map((l) => (
            <div className="legend-item" key={l.id}>
              <Chip tone={l.tone}>{l.id}</Chip>
              <span>
                <span className="legend-name">{l.name}</span>
                <br />
                <span className="legend-gloss">{l.gloss}</span>
              </span>
            </div>
          ))}
        </div>
      </Col>
    </div>
  </header>
);

const Distinction = ({ block }) => (
  <section className="section">
    <SectionHead title={block.title} right="load-bearing contrast" />
    <div className="g">
      <Col span={6}>
        <div className="dist-col">
          <Chip tone={block.left.tone}>{block.left.chip}</Chip>
          <h4>{block.left.heading}</h4>
          <p>{block.left.body}</p>
          <ul className="facts">
            {block.left.facts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      </Col>
      <Col span={6}>
        <div className="dist-col">
          <Chip tone={block.right.tone}>{block.right.chip}</Chip>
          <h4>{block.right.heading}</h4>
          <p>{block.right.body}</p>
          <p className="punch">{block.right.punch}</p>
        </div>
      </Col>
    </div>
  </section>
);

const Opportunity = ({ block }) => (
  <section>
    <div className="rule-2" />
    <div className="g opp">
      <Col span={2}>
        <div className="opp-index">{block.index}</div>
        <div className="opp-tag">{block.tag}</div>
      </Col>
      <Col span={8}>
        <h3 className="opp-title">{block.title}</h3>
        <p className="opp-body">{block.body}</p>
        {block.cases && (
          <ul className="cases">
            {block.cases.map((c) => (
              <li className="case" key={c.id}>
                <span className="cid">{c.id}</span>
                <span className="cname">{c.name}</span>
                <span className="cnote">{c.note}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="payoff">
          <span className="lab">Payoff</span>
          <span>{block.payoff}</span>
        </div>
      </Col>
      <Col span={2}>
        <div className="opp-chips">
          <Chip tone={block.tone}>{block.layer}</Chip>
          <Chip tone="plain">{block.method}</Chip>
        </div>
      </Col>
    </div>
  </section>
);

const MatchTable = ({ block }) => (
  <section className="section">
    <SectionHead title={block.title} right="not interchangeable" />
    <div className="g">
      <Col span={8} start={3}>
        {block.rows.map((r) => (
          <div className="mt-row" key={r.q}>
            <span className="mt-q">{r.q}</span>
            <span className="mt-arrow">→</span>
            <span className="mt-tool">{r.tool}</span>
          </div>
        ))}
        <p className="mt-note">{block.note}</p>
      </Col>
    </div>
  </section>
);

const Guardrails = ({ block }) => (
  <section className="section">
    <SectionHead title={block.title} right="the only red on the page" />
    <div className="g">
      <Col span={10} start={2}>
        {block.items.map((it) => (
          <div className="guard-item" key={it.dont}>
            <div className="guard-dont">{it.dont}</div>
            <p className="guard-why">{it.why}</p>
          </div>
        ))}
      </Col>
    </div>
  </section>
);

const Anchors = ({ block }) => (
  <section className="section">
    <SectionHead title={block.title} right="D1 · SD1 · P4" />
    <div className="g">
      {block.cards.map((c) => (
        <Col span={4} key={c.id}>
          <div className="anchor">
            <div className="anchor-head">
              <span className="mono" style={{ color: "var(--ultra)" }}>
                {c.id}
              </span>
              <span className="anchor-name">{c.name}</span>
            </div>
            <div className="anchor-row det">
              <span className="lab">Exact · L0</span>
              {c.det}
            </div>
            <div className="anchor-row stoch">
              <span className="lab">Bayesian question · L1</span>
              {c.stoch}
            </div>
          </div>
        </Col>
      ))}
    </div>
  </section>
);

const Recommendation = ({ block }) => (
  <section className="section">
    <SectionHead title={block.title} right="sequencing matters" />
    {block.steps.map((s) => (
      <div className="g step" key={s.when}>
        <Col span={2}>
          <div className="step-when">{s.when}</div>
          <div className="step-effort">{s.effort}</div>
        </Col>
        <Col span={9}>
          <p className="step-what">{s.what}</p>
        </Col>
      </div>
    ))}
  </section>
);

const Summary = ({ block }) => (
  <footer className="summary">
    <div className="wrap" style={{ padding: "26px 24px 34px" }}>
      <div className="lab" style={{ paddingBottom: 14 }}>
        {block.title}
      </div>
      {block.rows.map((r) => (
        <div className="sum-row" key={r.label}>
          <span className="lab">{r.label}</span>
          <p className="sum-text">{r.text}</p>
        </div>
      ))}
    </div>
  </footer>
);

/* ============================================================
   5 · BLOCK REGISTRY + RENDERER — the reusable core.
   Add a new block type: write a component, register it here.
   ============================================================ */

const REGISTRY = {
  distinction: Distinction,
  opportunity: Opportunity,
  matchTable: MatchTable,
  guardrails: Guardrails,
  anchors: Anchors,
  recommendation: Recommendation,
};

export default function SwissLayout() {
  const { meta, thesis, layers, blocks } = CONTENT;
  const summaryBlock = blocks.find((b) => b.type === "summary");

  return (
    <div className="swx">
      <style>{CSS}</style>
      <div className="wrap" style={{ paddingTop: 20 }}>
        <Masthead meta={meta} thesis={thesis} layers={layers} />
        {blocks
          .filter((b) => b.type !== "summary")
          .map((b, i) => {
            const Block = REGISTRY[b.type];
            return Block ? <Block block={b} key={i} /> : null;
          })}
      </div>
      {summaryBlock && <Summary block={summaryBlock} />}
    </div>
  );
}
