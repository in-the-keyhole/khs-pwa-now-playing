/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

// This service worker can be customized!
// See https://developers.google.com/web/tools/workbox/modules
// for the list of available Workbox modules, or add any other
// code you'd like.
// You can also remove this file if you'd prefer not to use a
// service worker, and the Workbox build step will be skipped.

import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import md5 from 'crypto-js/md5';
import { createStore, get, set, UseStore } from 'idb-keyval';

declare const self: ServiceWorkerGlobalScope;

clientsClaim();

// Precache all of the assets generated by your build process.
// Their URLs are injected into the manifest variable below.
// This variable must be present somewhere in your service worker file,
// even if you decide not to use precaching. See https://cra.link/PWA
precacheAndRoute(self.__WB_MANIFEST);

// Set up App Shell-style routing, so that all navigation requests
// are fulfilled with your index.html shell. Learn more at
// https://developers.google.com/web/fundamentals/architecture/app-shell
const fileExtensionRegexp = new RegExp('/[^/?]+\\.[^/]+$');
registerRoute(
  // Return false to exempt requests from being fulfilled by index.html.
  ({ request, url }: { request: Request; url: URL }) => {
    // If this isn't a navigation, skip.
    if (request.mode !== 'navigate') {
      return false;
    }

    // If this is a URL that starts with /_, skip.
    if (url.pathname.startsWith('/_')) {
      return false;
    }

    // If this looks like a URL for a resource, because it contains
    // a file extension, skip.
    if (url.pathname.match(fileExtensionRegexp)) {
      return false;
    }

    // Return true to signal that we want to use the handler.
    return true;
  },
  createHandlerBoundToURL(process.env.PUBLIC_URL + '/index.html')
);

// An example runtime caching route for requests that aren't handled by the
// precache, in this case same-origin .png requests like those from in public/
registerRoute(
  // Add in any other file extensions or routing criteria as needed.
  ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('.png'),
  // Customize this strategy as needed, e.g., by changing to CacheFirst.
  new StaleWhileRevalidate({
    cacheName: 'images',
    plugins: [
      // Ensure that once this runtime cache reaches a maximum size the
      // least-recently used images are removed.
      new ExpirationPlugin({ maxEntries: 50 }),
    ],
  })
);

// An example runtime caching route for requests for images not from the url origin
registerRoute(
  // Example URL: https://image.tmdb.org/t/p/w500/iRV0IB5xQeOymuGGUBarTecQVAl.jpg
  ({ url }) => url.origin.includes("image.tmdb.org") && url.pathname.endsWith('.jpg'),
  // Customize this strategy as needed, e.g., by changing to CacheFirst.
  new StaleWhileRevalidate({
    cacheName: 'movie-images',
    plugins: [
      // Ensure that once this runtime cache reaches a maximum size the
      // least-recently used images are removed.
      new ExpirationPlugin({ maxEntries: 50 }),
    ],
  })
);

// This allows the web app to trigger skipWaiting via
// registration.waiting.postMessage({type: 'SKIP_WAITING'})
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// An example of caching GraphQL POST calls
self.addEventListener('fetch', async (event) => {
  if (event.request.method === 'POST') {
    // Respond with cached data and update from network in the background.
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  let cachedResponse = await getCachedResponse(event.request.clone());
  let fetchPromise: any = fetch(event.request.clone())
    .then((response) => {
      setCachedResponse(event.request.clone(), response.clone());
      return response;
    })
    .catch((err) => {
      console.error(err);
    });
  return cachedResponse ? Promise.resolve(cachedResponse) : fetchPromise;
}

// The following is a cacheFirst example
// async function cacheFirst(event: FetchEvent): Promise<Response> {
//   const cachedResponse = await getCachedResponse(event.request.clone());

//   if (cachedResponse) {
//     return Promise.resolve(cachedResponse);
//   } else {
//     const fetchPromise: any = fetch(event.request.clone())
//       .then((response) => {
//         setCachedResponse(event.request.clone(), response.clone());
//         return response;
//       })
//       .catch((err) => {
//         console.error(err);
//       });
//     return fetchPromise;
//   }
// }

// The IndexedDB used by the GraphQL cache
const store: UseStore = createStore('graphql-cache', 'post-responses');

// An example adding a cache entry -- uses an MD5 hashkey of the request
async function setCachedResponse(request: Request, response: Response) {
  let body = await request.json();
  let id = md5(JSON.stringify(body)).toString();

  var entry = {
    query: body.query,
    response: await serializeResponse(response),
    timestamp: Date.now()
  };
  set(id, entry, store);
}

// An example getting a cache entry -- uses an MD5 hashkey of the request
async function getCachedResponse(request: Request) {
  let data;
  try {
    let body = await request.json();
    let id = md5(JSON.stringify(body)).toString();
    data = await get(id, store);
    if (!data) {
      console.log("Cache miss: ", id);
      return null;
    }

    // Check cache max age - if reached max, then it is a cache miss
    let cacheControl = request.headers.get('Cache-Control');
    let maxAge = cacheControl ? parseInt(cacheControl.split('=')[1]) : undefined;
    if (maxAge && (Date.now() - data.timestamp > maxAge * 1000)) {
      console.log(`Cache expired. Load from API endpoint.`);
      return null;
    }

    console.log("Cache hit:", id, data);
    return new Response(JSON.stringify(data.response.body), data.response);
  } catch (err) {
    return null;
  }
}

// Serialize the response for storage in the cache
async function serializeResponse(response: Response) {
  let serializedHeaders: any = {};
  for (var entry of response.headers.entries()) {
    serializedHeaders[entry[0]] = entry[1];
  }
  let serialized = {
    body: undefined,
    headers: serializedHeaders,
    status: response.status,
    statusText: response.statusText
  };
  serialized.body = await response.json();
  return serialized;
}