import { toolGuide, type Effect } from "@finance/mcp/guide";
import type { Metadata } from "next";
import { Badge, Card, Page, PageHeader, plural } from "@/components/page";
import type { Tone } from "@/components/styles";

export const metadata: Metadata = { title: "AI assistant" };

const EFFECTS: Record<Effect, { label: string; tone: Tone; means: string }> = {
  reads: { label: "Reads", tone: "muted", means: "looks, changes nothing" },
  adds: {
    label: "Adds",
    tone: "accent",
    means: "adds something new, leaves the rest as it is",
  },
  changes: {
    label: "Changes",
    tone: "warning",
    means:
      "changes or deletes what's there; the assistant should ask you first",
  },
};

// What an AI assistant connected to the app over MCP can do, read from the
// MCP server's own tools: the list can't miss one, and says what each gives
// back in the analyst's terms.
export default function AssistantHelpPage() {
  const areas = toolGuide();
  const tools = areas.flatMap((area) => area.tools);
  const counts = (Object.keys(EFFECTS) as Effect[]).map(
    (effect) =>
      `${tools.filter((t) => t.effect === effect).length} ${EFFECTS[effect].label.toLowerCase()}`,
  );

  return (
    <Page>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="AI assistant"
          description="An AI assistant your organization connects to the app, such as Claude, ChatGPT or Microsoft Copilot, works through the actions below. It works on your organization's data only, and the app's checks apply as they do here."
          meta={
            <span>
              {plural(tools.length, "action")}: {counts.join(", ")}
            </span>
          }
        />

        <Card title="How it works">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
            <li>
              The app computes every figure: analysis results, covenant tests,
              borrowing bases. The assistant enters what you give it and reports
              what the app computed.
            </li>
            <li>
              Spreads, certificates and projections you paste are previewed
              first. Nothing is saved until you confirm what was read.
            </li>
            <li>
              Templates and documents it writes stay drafts until a person
              publishes them here.
            </li>
          </ul>
          <dl className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-sm">
            {(Object.keys(EFFECTS) as Effect[]).map((effect) => (
              <div key={effect} className="flex items-baseline gap-2">
                <dt className="w-[4.5rem] shrink-0">
                  <Badge tone={EFFECTS[effect].tone}>
                    {EFFECTS[effect].label}
                  </Badge>
                </dt>
                <dd className="text-muted">{EFFECTS[effect].means}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <nav aria-label="Areas" className="flex flex-wrap gap-2">
          {areas.map((area) => (
            <a
              key={area.id}
              href={`#${area.id}`}
              className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-muted shadow-xs hover:bg-surface-2 hover:text-foreground"
            >
              {area.title}
            </a>
          ))}
        </nav>

        {areas.map((area) => (
          <div
            key={area.id}
            id={area.id}
            className="scroll-mt-16 md:scroll-mt-6"
          >
            <Card
              title={area.title}
              description={area.about}
              actions={
                <span className="text-xs text-muted">
                  {plural(area.tools.length, "action")}
                </span>
              }
              flush
            >
              <ul className="divide-y divide-line/70">
                {area.tools.map((tool) => (
                  <li
                    key={tool.name}
                    className="grid gap-x-6 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
                  >
                    <div className="flex min-w-0 flex-col items-start gap-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">
                          {tool.title}
                        </span>
                        <Badge tone={EFFECTS[tool.effect].tone}>
                          {EFFECTS[tool.effect].label}
                        </Badge>
                      </div>
                      <code
                        className="font-mono text-[11px] break-all text-muted"
                        title="The name your assistant shows when it uses this action"
                      >
                        {tool.name}
                      </code>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <p>{tool.does}</p>
                      <p className="text-muted">
                        <span className="font-medium text-foreground">
                          Gives back:
                        </span>{" "}
                        {tool.returns}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ))}
      </div>
    </Page>
  );
}
