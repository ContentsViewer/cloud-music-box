import type { RuntimeCaching, SerwistPlugin } from "serwist"
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  StaleWhileRevalidate,
} from "serwist"
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist"

import { Serwist } from "serwist"

// This declares the value of `injectionPoint` to TypeScript: the
// `__SW_MANIFEST` property on the worker global is the string the build
// replaces with the actual precache manifest.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

// The app shell (HTML, RSC .txt, JS, CSS) must always be served from the
// precache manifest of the SW that controls the page, never from the network:
// mixing builds (old HTML with new RSC payload or vice versa) makes the Next.js
// App Router fall back to a hard navigation on every route change. Updates
// apply when the user accepts the "A New Version is Available." snackbar
// (Reload -> SKIP_WAITING), or automatically at the next launch after the last
// client closes: the platform activates the waiting worker at zero clients and
// its activate cleanup purges the previous build — that part cannot be
// deferred. The guarantee is per session: the running build never changes
// while a window stays open.
//
// Navigations need no custom code: the built-in precache route resolves
// `/files` to the precached `files.html` (cleanURLs) and `/` to `index.html`
// (directoryIndex). RSC requests are the one exception, handled below.

// --- Update-window diagnostics (observation only — serving is unchanged) ---
//
// Five deployments in a row showed the controlling (old) SW serving the *new*
// build during the update install window: precache reads for entries that
// provably exist came back empty, and the production fallbacks
// (PrecacheStrategy's fallbackToNetwork, the RSC handler's fetch) silently
// substituted network content. Serwist's route matching and URL->key mapping
// are deterministic and verified correct, so the failing layer is the
// browser's own cache read — which never reproduced synthetically (~70k reads
// under install bursts on 15 GB origins). This layer records real failures
// with the context needed to identify the trigger: which handler missed,
// whether an install was in flight, the SW process age, and whether the entry
// reappears shortly after (transient vs persistent). Countermeasures are
// deliberately deferred until that data exists.

const SW_STARTED_AT = Date.now()
const DIAG_CACHE = "sw-diag"
const DIAG_MAX_ENTRIES = 256
const DIAG_PRUNE_BATCH = 64
const REPROBE_DELAYS_MS = [100, 500, 2000]

const diagLog = (kind: string, url: string, incident?: string) => {
  const record = {
    kind,
    url,
    t: Date.now(),
    swAgeMs: Date.now() - SW_STARTED_AT,
    installing: !!self.registration.installing,
    waiting: !!self.registration.waiting,
    incident,
  }
  console.warn("[sw-diag]", kind, url, record)
  void (async () => {
    try {
      const cache = await caches.open(DIAG_CACHE)
      const key = `/diag/${String(record.t).padStart(15, "0")}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
      await cache.put(new Request(key), new Response(JSON.stringify(record)))
      const keys = await cache.keys()
      if (keys.length > DIAG_MAX_ENTRIES) {
        // Keys embed a zero-padded timestamp, so URL order is chronological.
        const oldest = keys
          .map(k => k.url)
          .sort()
          .slice(0, DIAG_PRUNE_BATCH)
        for (const url of oldest) {
          await cache.delete(url)
        }
      }
    } catch {
      // Diagnostics must never break serving.
    }
  })()
}

// After a read came back empty, watch the same key from the side: if it
// reappears the miss was transient (a serving-side retry would have rescued
// it); if it stays empty the entry was really gone. Runs detached — the
// response the user gets is never delayed by this.
const reprobe = (
  cacheName: string,
  request: Request,
  matchOptions: CacheQueryOptions | undefined,
  incident: string
) => {
  const t0 = Date.now()
  void (async () => {
    try {
      for (const delay of REPROBE_DELAYS_MS) {
        await new Promise(resolve => setTimeout(resolve, delay))
        const cache = await caches.open(cacheName)
        const hit = await cache.match(request, matchOptions)
        diagLog(
          `${hit ? "reprobe-hit" : "reprobe-null"}@${Date.now() - t0}ms`,
          request.url,
          incident
        )
      }
    } catch {
      // Observation only.
    }
  })()
}

const newIncidentId = () => Math.random().toString(36).slice(2, 10)

// Runs inside every precache read (StrategyHandler.cacheMatch). The event
// filter keeps install-time read-checks (expected misses for changed entries)
// out of the log. `request` is the revisioned cache key at this point, so the
// reprobe can match it directly. Returning cachedResponse unchanged keeps
// serving identical: misses still fall through to fallbackToNetwork.
const precacheReadObserverPlugin: SerwistPlugin = {
  cachedResponseWillBeUsed: async ({
    cacheName,
    request,
    matchOptions,
    cachedResponse,
    event,
  }) => {
    if (!cachedResponse && event && event.type === "fetch") {
      const incident = newIncidentId()
      diagLog("precache-read-null", request.url, incident)
      reprobe(cacheName, request, matchOptions, incident)
    }
    return cachedResponse
  },
}
// ---------------------------------------------------------------------------

// RSC payload requests (`/route.txt?_rsc=...`) never match the precache route
// as-is: the request carries a per-navigation `_rsc` query while the cache key
// carries `__WB_REVISION__`. Resolving the bare pathname through
// `matchPrecache` maps it onto the controlling SW's own manifest entry, which
// both fixes the query mismatch and pins the response to the current build.
const createRscHandler = (serwist: Serwist) => {
  return async ({ request }: { request: Request }): Promise<Response> => {
    const url = new URL(request.url)
    const precacheKey = serwist.getPrecacheKeyForUrl(url.pathname)
    if (!precacheKey) {
      // Genuinely outside this build's manifest (a new un-precached route):
      // deterministic, not a cache failure. Let the network answer; a failure
      // here surfaces to the App Router, which falls back to a full
      // navigation handled by the precache route.
      diagLog("rsc-manifest-miss", request.url)
      return fetch(request)
    }
    const precached = await serwist.matchPrecache(url.pathname)
    if (precached) {
      return precached
    }
    // The manifest maps this URL to a cache key but the read came back empty
    // — the same failure mode precacheReadObserverPlugin records for
    // navigations. Serve the network as before (Next's buildId check turns a
    // cross-build payload into a full navigation), but leave the evidence.
    const incident = newIncidentId()
    diagLog("rsc-read-null", request.url, incident)
    reprobe(
      serwist.precacheStrategy.cacheName,
      new Request(precacheKey),
      serwist.precacheStrategy.matchOptions,
      incident
    )
    return fetch(request)
  }
}

const buildRuntimeCaching = (serwist: Serwist): RuntimeCaching[] =>
  process.env.NODE_ENV !== "production"
    ? []
    : [
        {
          matcher: /^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,
          handler: new CacheFirst({
            cacheName: "google-fonts-webfonts",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 4,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 365 days
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        {
          matcher: /^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,
          handler: new StaleWhileRevalidate({
            cacheName: "google-fonts-stylesheets",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 4,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        {
          matcher: /\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,
          handler: new StaleWhileRevalidate({
            cacheName: "static-font-assets",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 4,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        {
          matcher: /\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,
          handler: new StaleWhileRevalidate({
            cacheName: "static-image-assets",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 64,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        // Covers prefetch requests (`Next-Router-Prefetch: 1`) as well: they
        // must resolve to the same build as everything else, so they get no
        // separate rule.
        {
          matcher: ({ request, url: { pathname }, sameOrigin }) =>
            request.headers.get("RSC") === "1" &&
            sameOrigin &&
            !pathname.startsWith("/api/"),
          handler: createRscHandler(serwist),
        },
        // Fallback for build assets that escaped the precache manifest.
        // Hashed URLs are immutable, so a long max age is correct; the
        // expiration only garbage-collects files of abandoned builds, which
        // no manifest cleanup ever touches in this runtime cache.
        {
          matcher: /\/_next\/static.+\.js$/i,
          handler: new CacheFirst({
            cacheName: "next-static-js-assets",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 64,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 365 days
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        {
          matcher: /\.(?:css|less)$/i,
          handler: new StaleWhileRevalidate({
            cacheName: "static-style-assets",
            plugins: [
              new ExpirationPlugin({
                maxEntries: 32,
                maxAgeSeconds: 24 * 60 * 60, // 24 hours
                maxAgeFrom: "last-used",
              }),
            ],
          }),
        },
        // Miscellany (manifest.json etc.) and the safety net for navigations
        // that missed the precache route entirely. The timeout matters: on a
        // slow-but-connected network, NetworkFirst without one waits for the
        // full round trip and never falls back to cache.
        {
          matcher: ({ url: { pathname }, sameOrigin }) =>
            sameOrigin && !pathname.startsWith("/api/"),
          handler: new NetworkFirst({
            cacheName: "others",
            networkTimeoutSeconds: 5,
            plugins: [
              new ExpirationPlugin({
                maxEntries: 32,
                maxAgeSeconds: 24 * 60 * 60, // 24 hours
              }),
            ],
          }),
        },
      ]

// Read the injection point exactly once - the build-time injection requires
// a single occurrence of the token in the emitted source (comments included,
// which is why no comment here spells it out).
const precacheManifest = self.__SW_MANIFEST

// --- Build-info handshake (observation only) --------------------------------
// The page asks its controller which build it is (nav-diag sends
// GET_BUILD_INFO with a MessageChannel port at startup). A mismatch against
// the page's own version reveals a cross-build state — the update-window
// leak — regardless of which browser path let it happen. The manifest
// revision (per-build nanoid) distinguishes deploys even when the package
// version did not change.
const MANIFEST_REVISION = (() => {
  for (const entry of precacheManifest ?? []) {
    if (typeof entry !== "string" && entry.url === "404.html") {
      return entry.revision ?? undefined
    }
  }
  return undefined
})()

self.addEventListener("message", event => {
  if (event.data && event.data.type === "GET_BUILD_INFO") {
    event.ports[0]?.postMessage({
      appVersion: process.env.APP_VERSION,
      manifestRevision: MANIFEST_REVISION,
    })
  }
})

const serwist = new Serwist({
  precacheEntries: precacheManifest,
  precacheOptions: {
    cacheName: "serwist-precache",
    // Observation only (see diagnostics section above): records precache
    // read misses with context, never alters what is served.
    plugins: [precacheReadObserverPlugin],
    // Static export: every route's HTML is a pure function of the pathname —
    // query strings are read only by client JS. The OAuth/Picker returns land
    // on /redirect/google-drive?code=…&picked_file_ids=…, and with the
    // default ignore list (utm_/fbclid only) any query-carrying navigation
    // misses the precache and falls through to navigateFallback: the 404
    // page. Ignoring all parameters makes the SW resolve URLs exactly like
    // the static file server does.
    ignoreURLParametersMatching: [/.*/],
    // Navigations to URLs outside the manifest (deep link typos etc.) get the
    // prerendered 404 page instead of hanging on the network. Bound only when
    // a manifest exists: createHandlerBoundToURL throws at construction for
    // non-precached URLs, which would kill the whole dev SW (no manifest).
    ...(precacheManifest ? { navigateFallback: "404.html" } : {}),
  },
  // skipWaiting/clientsClaim stay disabled: activation waits for the
  // snackbar's Reload (SKIP_WAITING) or for the last client to close — the
  // platform's zero-client activation, which cannot be deferred. Within a
  // session the precache keeps serving one consistent build.
  // Navigation preload is an optimization for network-first navigation
  // handlers; navigations are served from the precache here, so it would
  // only fire a wasted network request per navigation.
  navigationPreload: false,
})

// Same registration path the constructor's `runtimeCaching` option uses;
// registering after construction lets the handlers close over the instance
// (for matchPrecache) while the precache route stays first in the router.
for (const entry of buildRuntimeCaching(serwist)) {
  serwist.registerCapture(entry.matcher, entry.handler, entry.method)
}

// Runtime caches dropped by this rework; delete them so abandoned entries
// stop occupying quota shared with the music blob cache.
const OBSOLETE_RUNTIME_CACHES = [
  "pages-rsc-prefetch",
  "pages-rsc",
  "pages",
  "apis",
  "next-data",
  "next-image",
  "static-data-assets",
  "static-audio-assets",
  "static-video-assets",
  "static-js-assets",
]

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all(OBSOLETE_RUNTIME_CACHES.map(name => caches.delete(name)))
  )
})

serwist.addEventListeners()
