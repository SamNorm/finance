export { casing, createDb, type Db, type Schema } from "./client";
export * as schema from "./schema";

// Query operators, re-exported so every package uses this package's drizzle-orm.
export {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  max,
  sql,
} from "drizzle-orm";
