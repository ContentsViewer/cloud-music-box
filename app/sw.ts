import type { RuntimeCaching } from "serwist"
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
// reach users only through the SW update cycle (install -> snackbar -> reload).
//
// Navigations need no custom code: the built-in precache route resolves
// `/files` to the precached `files.html` (cleanURLs) and `/` to `index.html`
// (directoryIndex). RSC requests are the one exception, handled below.

// RSC payload requests (`/route.txt?_rsc=...`) never match the precache route
// as-is: the request carries a per-navigation `_rsc` query while the cache key
// carries `__WB_REVISION__`. Resolving the bare pathname through
// `matchPrecache` maps it onto the controlling SW's own manifest entry, which
// both fixes the query mismatch and pins the response to the current build.
const createRscHandler = (serwist: Serwist) => {
  return async ({ request }: { request: Request }): Promise<Response> => {
    const url = new URL(request.url)
    const precached = await serwist.matchPrecache(url.pathname)
    if (precached) {
      return precached
    }
    // Not part of this build's manifest (new un-precached route or evicted
    // entry): let the network answer. A failure here surfaces to the App
    // Router, which falls back to a full navigation handled by the precache
    // route.
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

const serwist = new Serwist({
  precacheEntries: precacheManifest,
  precacheOptions: {
    cacheName: "serwist-precache",
    // Navigations to URLs outside the manifest (deep link typos etc.) get the
    // prerendered 404 page instead of hanging on the network. Bound only when
    // a manifest exists: createHandlerBoundToURL throws at construction for
    // non-precached URLs, which would kill the whole dev SW (no manifest).
    ...(precacheManifest ? { navigateFallback: "404.html" } : {}),
  },
  // skipWaiting/clientsClaim stay disabled: updates apply when the user
  // accepts the "A New Version is Available." snackbar, and the precache
  // keeps serving one consistent build until then.
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
