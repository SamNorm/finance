export {
  casing,
  createClient,
  createDb,
  type Client,
  type Db,
  type Schema,
} from "./client";
export * as schema from "./schema";

// Query operators, re-exported so every package uses this package's drizzle-orm.
export {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  max,
  or,
  sql,
} from "drizzle-orm";
