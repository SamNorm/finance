// Who is acting. Every domain function takes one and scopes its queries by the
// organization. Local dev injects a fixed context (§9.5); auth will build the
// same shape from the session, leaving the domain code untouched.
export interface Context {
  organizationId: string;
}

export const devContext: Context = {
  organizationId: "00000000-0000-4000-8000-000000000001",
};
