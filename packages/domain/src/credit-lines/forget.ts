import { and, eq, inArray, schema, type Db } from "@finance/db";

// What analyses of a borrower say of lines that are gone, forgotten: the
// usage they assume, how they project a borrowing base and the client's
// projected figures for it, and in scenarios, the lines they propose and
// their changes. Otherwise a proposed change to a line no longer there
// reads as a new line. Lines are matched by key as analyses know them
// ("member/line" for a consolidated client's).
export async function forgetLines(
  db: Db,
  entityId: string,
  forgotten: (key: string) => boolean,
): Promise<void> {
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !forgotten(key)),
    );
  const affected = await db
    .select()
    .from(schema.analyses)
    .where(eq(schema.analyses.entityId, entityId));
  for (const analysis of affected) {
    await db
      .update(schema.analyses)
      .set({
        lineUsage: keep(analysis.lineUsage),
        borrowingBases: keep(analysis.borrowingBases),
      })
      .where(eq(schema.analyses.id, analysis.id));
    const forecast = await db
      .select({ lineId: schema.analysisBorrowingBaseValues.lineId })
      .from(schema.analysisBorrowingBaseValues)
      .where(eq(schema.analysisBorrowingBaseValues.analysisId, analysis.id));
    const gone = [...new Set(forecast.map((f) => f.lineId))].filter(forgotten);
    if (gone.length)
      await db
        .delete(schema.analysisBorrowingBaseValues)
        .where(
          and(
            eq(schema.analysisBorrowingBaseValues.analysisId, analysis.id),
            inArray(schema.analysisBorrowingBaseValues.lineId, gone),
          ),
        );
    const scenarios = await db
      .select()
      .from(schema.analysisScenarios)
      .where(eq(schema.analysisScenarios.analysisId, analysis.id));
    for (const scenario of scenarios)
      await db
        .update(schema.analysisScenarios)
        .set({
          lineUsage: keep(scenario.lineUsage),
          borrowingBases: keep(scenario.borrowingBases),
          lines: scenario.lines?.filter((l) => !forgotten(l.id)) ?? null,
        })
        .where(eq(schema.analysisScenarios.id, scenario.id));
  }
}
