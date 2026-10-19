import { DomainError, getGroupBorrowingBase } from "@finance/domain";
import { Building2, Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge, EmptyState, Page, PageHeader } from "@/components/page";
import { button } from "@/components/styles";
import { Tabs } from "@/components/tabs";
import { getContext, getDb } from "@/lib/server";
import { GroupCharts, GroupResults } from "../../_components/group-results";
import { GroupWorksheet } from "../../_components/group-worksheet";

export const metadata: Metadata = { title: "Group borrowing base" };

export default function GroupBorrowingBasePage({
  params,
  searchParams,
}: PageProps<"/borrowing-bases/group/[entityId]">) {
  return (
    <Page wide>
      <Suspense fallback={<Loading />}>
        <GroupView params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

type Props = Pick<
  PageProps<"/borrowing-bases/group/[entityId]">,
  "params" | "searchParams"
>;

// A consolidated client's borrowing base (borrowing-base-plan.md §7.5): its
// members' margined lines, each computed on its own terms, added up month
// by month, adjusted, or replaced by a certificate for the group.
async function GroupView({ params, searchParams }: Props) {
  const [{ entityId }, query] = await Promise.all([params, searchParams]);
  const db = getDb();
  const ctx = await getContext();
  // A borrower that isn't a consolidated client has no group page.
  const group = await getGroupBorrowingBase(db, ctx, entityId).catch(
    (error) => {
      if (
        error instanceof DomainError &&
        (error.kind === "not_found" || error.kind === "invalid")
      )
        notFound();
      throw error;
    },
  );
  const { entity, members, months, issues } = group;
  const flagged = [...issues, ...months.flatMap((m) => m.issues)];
  const borrower = `/borrowers/${entity.id}?tab=existing-debt`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ href: "/borrowing-bases", label: "Borrowing bases" }]}
        title={entity.name}
        badges={
          <span title="Adds up its members' margined lines, month by month.">
            <Badge tone="accent">Consolidated</Badge>
          </span>
        }
        meta={
          <>
            <Link
              href={borrower}
              className="flex items-center gap-1.5 text-accent hover:underline"
            >
              <Building2 className="size-3.5" aria-hidden />
              {entity.name}
            </Link>
            {members.map((m) => (
              <Link
                key={m.key}
                href={`/borrowing-bases/${m.lineId}`}
                className="flex items-center gap-1.5 hover:text-accent hover:underline"
              >
                <Gauge className="size-3.5" aria-hidden />
                {m.name}
              </Link>
            ))}
          </>
        }
      />
      {members.length === 0 ? (
        <EmptyState
          icon={<Gauge />}
          title="None of the members' lines is margined."
          actions={
            <Link href={borrower} className={button.secondary}>
              Open {entity.name}
            </Link>
          }
        >
          Margin a member&apos;s line from the member&apos;s Existing debt tab:
          the group adds up its members&apos; borrowing bases.
        </EmptyState>
      ) : (
        <Tabs
          initial={typeof query.tab === "string" ? query.tab : undefined}
          tabs={[
            {
              value: "results",
              label: "Results",
              alert: flagged.length ? "warning" : undefined,
              content: (
                <GroupResults
                  months={months}
                  members={members}
                  issues={issues}
                />
              ),
            },
            {
              value: "worksheet",
              label: "Worksheet",
              count: months.length,
              content: (
                <GroupWorksheet
                  entityId={entity.id}
                  months={months}
                  members={members}
                  initialMonth={
                    typeof query.month === "string" ? query.month : undefined
                  }
                />
              ),
            },
            {
              value: "charts",
              label: "Charts",
              content: <GroupCharts months={months} members={members} />,
            },
          ]}
        />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-label="Loading">
      <div className="flex flex-col gap-2">
        <div className="h-3 w-24 rounded bg-surface-2" />
        <div className="h-7 w-72 rounded bg-surface-2" />
        <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      </div>
      <div className="h-10 w-full rounded bg-surface-2" />
      <div className="h-28 w-full rounded-xl bg-surface-2" />
      <div className="h-96 w-full rounded-xl bg-surface-2" />
    </div>
  );
}
