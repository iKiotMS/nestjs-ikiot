/**
 * The part of a login response AuditInterceptor reads.
 *
 * `/auth/login` and `/auth/firebase-login` are `@Public()`, so JwtStrategy never runs and
 * `request.user` is empty — the interceptor has to identify the actor from the response
 * body instead. It used to do that by casting each field off an untyped object, which
 * meant a change to AuthService's response silently produced audit rows with a blank
 * name or role.
 *
 * AuthService declares this shape via `satisfies`, so that change is now a build error.
 * It is a *subset*: the real response carries the whole user row, and nothing here
 * constrains what else may be returned.
 */
export interface AuditableLoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string | null;
    phoneNumber: string;
    systemRole: string;
    tenantId: string | null;
    profileFirstName: string | null;
    profileLastName: string | null;
  };
}
