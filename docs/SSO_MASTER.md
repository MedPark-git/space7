# MedPark One SSO master

MedPark One is the OpenID Connect issuer for AI SPACE. Amaranth is outside this
boundary. Each application remains responsible for its own roles, permissions,
and record ownership.

## Endpoints

- Issuer: `https://medprk-medpark-one.mycafe24.ai/sso`
- Discovery: `/sso/.well-known/openid-configuration`
- Authorization: `/sso/authorize`
- Token: `/sso/token`
- UserInfo: `/sso/userinfo`
- JWKS: `/sso/jwks.json`
- RP-initiated logout: `/sso/logout`

The provider supports authorization code flow, mandatory S256 PKCE, RS256 ID
tokens, exact redirect URI matching, one-time two-minute authorization codes,
one-hour access tokens, UserInfo, and back-channel logout notifications.

## Client rules

Server applications use `client_secret_basic` plus PKCE. Browser-only
applications use a public client without a secret and still require PKCE.
Client secrets and the signing private key are deployment environment values;
they are not stored in source, configuration downloads, or audit metadata.

An administrator must link `(iss, sub)` to an existing local account before a
client grants access. Clients must not create accounts automatically. Local
roles and permissions remain authoritative.

## Adding a future AI SPACE site

1. Assign the reserved space's client ID.
2. Register the exact `https://{project}.mycafe24.ai/auth/sso/callback` URI.
3. Choose web or browser application type.
4. For web applications, generate and set a unique client secret in the master
   and client deployment environments.
5. Add the client callback and back-channel logout handlers.
6. Verify code replay, state, nonce, PKCE, account linking, local authorization,
   central logout, and disabled-user behavior before removing the old login.
