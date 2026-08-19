# Credentials and access

What POESESSID is, why it is treated as a password, and what the token protects.

[← back to the README](../README.md)

---

## POESESSID, and why it is treated this way

`POESESSID` **is not a scoped API key**. It is a session cookie: whoever holds it is logged in as
you. No trading restriction, no read-only access to just the stash — the whole account.

That is what the code's handling of it follows from:

| Where | What happens |
|-------|--------------|
| Logs | `registerSecret()` registers the value, every error path washes its text through `scrub()`, and a pino hook scrubs every string handed to a log method. On top of that, pino's `redact` blanks the `cookie` and `authorization` headers. |
| Error messages | `StashError` scrubs its message in the constructor. The `/api/poll` response is scrubbed before it is sent. |
| The browser | `/api/config` returns the league, the schedule and the thresholds — never the credential. A test asserts the response does not contain even the word `poesessid`. |
| URLs | The credential travels in a `Cookie` header and never in a URL, where it would land in a proxy log. |
| Git | `.env` and `/data` have been in `.gitignore` since the first commit. |

The cookie expires on its own. When it does, `/api/health` says so in as many words
(*POESESSID has most likely expired*) rather than letting the chart quietly stop moving.

> **▸ Why the collector does not block startup without a credential:** the server comes up
> without one. History already collected stays readable, and `/api/health` says what is missing.
> Refusing to start would take the charts down at exactly the moment you are replacing an expired
> credential.

### Yes, GGG has an official OAuth — and why it is not used here

This is the first question anybody asks, so the answer belongs here rather than in the issues.

GGG offers an official OAuth 2.0 API with an `account:stashes` scope meant for exactly this. It
would be better by every measure:

| | POESESSID | OAuth |
|---|---|---|
| Scope | **The whole account.** Trade, stash, messages | Only the granted scopes |
| Revocation | Change your password | Revoke the application's grant |
| Expiry | Vague | Access ~28 days, refresh ~90 days |
| Standing | A private API | Documented and supported |

**Why it still will not do here:** GGG requires an OAuth application's redirect URI to be HTTPS
on a **registered domain you own**. IP addresses and `localhost` are not accepted, not even in
development. The application also has to be registered and approved.

That is in direct conflict with what What Remains is. It binds to loopback by default,
`docker compose` publishes the port to `127.0.0.1` only, and the entire premise is one person's
self-hosted tool on their own machine. Such a thing has no domain, and should not need one.

The exception is a Fly deployment, which does have a domain. If you run it there **and** get an
application registered with GGG, OAuth would be technically possible — but it is not the same
application any more: OAuth's stash endpoints differ from `character-window/get-stash-items`, so
the response shape, the pagination and the rate limiting would all have to be worked through
again.

> **▸ What this means for you:** treat POESESSID as a password, because it is one. Do not paste
> it into an issue, do not leave it in a screenshot, and if you suspect it has leaked, log out of
> all sessions on pathofexile.com — that invalidates the cookie.

> **▸ On accuracy:** the OAuth details above were read from secondary sources rather than from
> GGG's documentation directly. Check
> [pathofexile.com/developer/docs/authorization](https://www.pathofexile.com/developer/docs/authorization)
> before making decisions that rest on them — the API has changed before and may change again.

---

## Access control

This application is single-user, but *single-user* says who **ought** to read the data — not who
is **able** to. There are three things to protect: the account's entire wealth history, the names
of its stash tabs, and `POST /api/poll`, which spends the account's GGG rate-limit budget on
demand. The last is the nastiest: it is precisely the resource the whole rate limiter exists to
protect, and exhausting it earns a timeout from GGG.

Three separate gates, because they stop three different things:

| Gate | What it stops |
|------|---------------|
| **Token** | Anyone without the `AUTH_TOKEN`. The comparison is constant-time, with both sides hashed first. |
| **Origin check** | A page you happen to visit that sends `POST /api/poll` in your browser's name. A token does not help here — the browser would attach it itself. |
| **Host check** | DNS rebinding: the attacker's hostname resolves to `127.0.0.1`, which makes the browser treat their script as the same origin as your dashboard. |

### The server refuses to start in the wrong combination

One configuration is simply unsafe: reachable from outside the machine, with nothing in front of
it. In that case `loadConfig` throws and the process does not come up:

```
refusing to serve an unauthenticated API on 0.0.0.0. This exposes the full wealth history
of the account and a POST /api/poll that spends its GGG rate-limit budget. Set AUTH_TOKEN
(`openssl rand -hex 32`), or bind HOST=127.0.0.1, or set ALLOW_UNAUTHENTICATED=1 if
something in front of it is already authenticating.
```

> **▸ Why a crash rather than a warning:** a warning on line 40 of a log is a warning nobody
> reads. The difference between the two configurations is not cosmetic either — in one of them
> the account's wealth is public. Failing at startup is the only feedback that arrives in time.

> **▸ Why `ALLOW_UNAUTHENTICATED` exists:** because "reachable from outside" does not always mean
> "unprotected". Compose publishes the port to `127.0.0.1`, a Tailscale interface is private, a
> reverse proxy may do its own authentication. A container still has to listen on `0.0.0.0` to be
> reachable at all. The flag is an acknowledgement, not a switch: it does not make an exposed
> instance safe.

### `/api/health` answers in two registers

A health check has to work before anyone has had a chance to give Docker or Fly a token, so it is
the one route outside the token. It still does not tell everything:

```bash
curl localhost:3000/api/health
# {"status":"up"}

curl -H "Authorization: Bearer $AUTH_TOKEN" localhost:3000/api/health
# {"status":"unconfigured","league":"Settlers","poller":{…},"rateLimit":{…},"prices":{…}}
```

> **▸ Why the split:** a liveness probe needs to know whether the process answers. The collector's
> error messages, the account's position in GGG's rate limiter and the age of the prices are
> diagnostics about a named account. Those two things do not belong in the same response.

### The token in the browser

The browser asks for the token once and keeps it in `sessionStorage` — it dies with the tab. The
token travels in an `Authorization` header, never as a cookie and never in a URL.

> **▸ Why not a cookie:** a cookie is attached automatically to a request sent by an attacker's
> page too, which is the whole of the CSRF problem. A header forces a preflight, which the
> browser will not perform for a foreign origin.

---

## What leaves the machine

Three hosts, and nothing else:

| Host | What is sent | Carries the credential? |
|------|--------------|-------------------------|
| `pathofexile.com` | The stash and profile requests. | Yes — the `Cookie` header. This is the point of the app. |
| `poe.ninja` | League name and category, in the URL. | No. |
| `api.github.com` | Nothing but a `User-Agent`: "is there a newer release?" | No. |

The last one is the only request that is not about the stash, and the only one the app makes
about itself. It runs at startup and once a day thereafter, has no account name, session or
token attached, and what GitHub learns from it is that an IP address asked about a public
repository — the same thing it learns from anyone opening the releases page.

It can be switched off: untick **Check for new versions** in the desktop panel, or set
`UPDATE_CHECK=off`. The app then never contacts GitHub, and never says anything about versions.

> **▸ Why it only checks, and never installs:** downloading and swapping out a running program's
> own binary is a different feature with a different threat model. It wants code signing before
> it wants a button; without one, an auto-updater is a thing that replaces your executable with
> something it fetched from the internet. So this notices, links to the release page, and leaves
> the decision where it belongs.
