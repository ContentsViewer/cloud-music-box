if(!self.define){let e,c={};const i=(i,s)=>(i=new URL(i+".js",s).href,c[i]||new Promise((c=>{if("document"in self){const e=document.createElement("script");e.src=i,e.onload=c,document.head.appendChild(e)}else e=i,importScripts(i),c()})).then((()=>{let e=c[i];if(!e)throw new Error(`Module ${i} didn’t register its module`);return e})));self.define=(s,t)=>{const n=e||("document"in self?document.currentScript.src:"")||location.href;if(c[n])return;let a={};const d=e=>i(e,n),u={module:{uri:n},exports:a,require:d};c[n]=Promise.all(s.map((e=>u[e]||d(e)))).then((e=>(t(...e),a)))}}define(["./workbox-07a7b4f2"],(function(e){"use strict";importScripts(),self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([{url:"/cloud-music-client/_next/static/chunks/134.e87850dc930744a4.js",revision:"e87850dc930744a4"},{url:"/cloud-music-client/_next/static/chunks/380-f35182f0ff3751fc.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/428-8795a87696e05252.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/520-e3d50c13b908d0c5.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/69-d408b82de782d4ad.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/808-0a5d098cb88d86d8.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/837-c4aa674e27b2ccc5.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/app/_not-found-f7a3de25e513dbd7.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/app/files/page-f3312555c9b9864c.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/app/layout-6556608c699020d4.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/app/page-07ed3474370b530d.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/fd9d1056-f23b3ca3ba0f1162.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/framework-aec844d2ccbe7592.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/main-914ddd014bca0055.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/main-app-fe7256d3fdd8c112.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/pages/_app-75f6107b0260711c.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/pages/_error-9a890acb1e81c3fc.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/chunks/polyfills-c67a75d1b6f99dc8.js",revision:"837c0df77fd5009c9e46d446188ecfd0"},{url:"/cloud-music-client/_next/static/chunks/webpack-dcb608870e1371f2.js",revision:"jBgrLKU5MKlz4SU_rXb4M"},{url:"/cloud-music-client/_next/static/css/4e65daab96492654.css",revision:"4e65daab96492654"},{url:"/cloud-music-client/_next/static/css/6dc72bef620ec6f7.css",revision:"6dc72bef620ec6f7"},{url:"/cloud-music-client/_next/static/jBgrLKU5MKlz4SU_rXb4M/_buildManifest.js",revision:"e0a21c7d7f93d89dce16df0231dc76f2"},{url:"/cloud-music-client/_next/static/jBgrLKU5MKlz4SU_rXb4M/_ssgManifest.js",revision:"b6652df95db52feb4daf4eca35380933"},{url:"/cloud-music-client/_next/static/media/0e4fe491bf84089c-s.p.woff2",revision:"5e22a46c04d947a36ea0cad07afcc9e1"},{url:"/cloud-music-client/_next/static/media/1c57ca6f5208a29b-s.woff2",revision:"491a7a9678c3cfd4f86c092c68480f23"},{url:"/cloud-music-client/_next/static/media/3dbd163d3bb09d47-s.woff2",revision:"93dcb0c222437699e9dd591d8b5a6b85"},{url:"/cloud-music-client/_next/static/media/42d52f46a26971a3-s.woff2",revision:"b44d0dd122f9146504d444f290252d88"},{url:"/cloud-music-client/_next/static/media/44c3f6d12248be7f-s.woff2",revision:"705e5297b1a92dac3b13b2705b7156a7"},{url:"/cloud-music-client/_next/static/media/4a8324e71b197806-s.woff2",revision:"5fba57b10417c946c556545c9f348bbd"},{url:"/cloud-music-client/_next/static/media/5647e4c23315a2d2-s.woff2",revision:"e64969a373d0acf2586d1fd4224abb90"},{url:"/cloud-music-client/_next/static/media/627622453ef56b0d-s.p.woff2",revision:"e7df3d0942815909add8f9d0c40d00d9"},{url:"/cloud-music-client/_next/static/media/71ba03c5176fbd9c-s.woff2",revision:"2effa1fe2d0dff3e7b8c35ee120e0d05"},{url:"/cloud-music-client/_next/static/media/7be645d133f3ee22-s.woff2",revision:"3ba6fb27a0ea92c2f1513add6dbddf37"},{url:"/cloud-music-client/_next/static/media/7c53f7419436e04b-s.woff2",revision:"fd4ff709e3581e3f62e40e90260a1ad7"},{url:"/cloud-music-client/_next/static/media/7d8c9b0ca4a64a5a-s.p.woff2",revision:"0772a436bbaaaf4381e9d87bab168217"},{url:"/cloud-music-client/_next/static/media/83e4d81063b4b659-s.woff2",revision:"bd30db6b297b76f3a3a76f8d8ec5aac9"},{url:"/cloud-music-client/_next/static/media/8fb72f69fba4e3d2-s.woff2",revision:"7a2e2eae214e49b4333030f789100720"},{url:"/cloud-music-client/_next/static/media/912a9cfe43c928d9-s.woff2",revision:"376ffe2ca0b038d08d5e582ec13a310f"},{url:"/cloud-music-client/_next/static/media/934c4b7cb736f2a3-s.p.woff2",revision:"1f6d3cf6d38f25d83d95f5a800b8cac3"},{url:"/cloud-music-client/_next/static/media/a5b77b63ef20339c-s.woff2",revision:"96e992d510ed36aa573ab75df8698b42"},{url:"/cloud-music-client/_next/static/media/a6d330d7873e7320-s.woff2",revision:"f7ec4e2d6c9f82076c56a871d1d23a2d"},{url:"/cloud-music-client/_next/static/media/baf12dd90520ae41-s.woff2",revision:"8096f9b1a15c26638179b6c9499ff260"},{url:"/cloud-music-client/_next/static/media/bbdb6f0234009aba-s.woff2",revision:"5756151c819325914806c6be65088b13"},{url:"/cloud-music-client/_next/static/media/bd976642b4f7fd99-s.woff2",revision:"cc0ffafe16e997fe75c32c5c6837e781"},{url:"/cloud-music-client/_next/static/media/cff529cd86cc0276-s.woff2",revision:"c2b2c28b98016afb2cb7e029c23f1f9f"},{url:"/cloud-music-client/_next/static/media/d117eea74e01de14-s.woff2",revision:"4d1e5298f2c7e19ba39a6ac8d88e91bd"},{url:"/cloud-music-client/_next/static/media/de9eb3a9f0fa9e10-s.woff2",revision:"7155c037c22abdc74e4e6be351c0593c"},{url:"/cloud-music-client/_next/static/media/dfa8b99978df7bbc-s.woff2",revision:"7a500aa24dccfcf0cc60f781072614f5"},{url:"/cloud-music-client/_next/static/media/e25729ca87cc7df9-s.woff2",revision:"9a74bbc5f0d651f8f5b6df4fb3c5c755"},{url:"/cloud-music-client/_next/static/media/eb52b768f62eeeb4-s.woff2",revision:"90687dc5a4b6b6271c9f1c1d4986ca10"},{url:"/cloud-music-client/_next/static/media/f06116e890b3dadb-s.woff2",revision:"2855f7c90916c37fe4e6bd36205a26a8"},{url:"/cloud-music-client/icon.png",revision:"ac42d2cd77f6ec2d8331161766d2ed98"},{url:"/cloud-music-client/manifest.json",revision:"abe0bc74f18ba956768d702e23e8510c"},{url:"/cloud-music-client/next.svg",revision:"8e061864f388b47f33a1c3780831193e"}],{ignoreURLParametersMatching:[]}),e.cleanupOutdatedCaches(),e.registerRoute("/cloud-music-client",new e.NetworkFirst({cacheName:"start-url",plugins:[{cacheWillUpdate:async({request:e,response:c,event:i,state:s})=>c&&"opaqueredirect"===c.type?new Response(c.body,{status:200,statusText:"OK",headers:c.headers}):c}]}),"GET"),e.registerRoute(/^https:\/\/fonts\.(?:gstatic)\.com\/.*/i,new e.CacheFirst({cacheName:"google-fonts-webfonts",plugins:[new e.ExpirationPlugin({maxEntries:4,maxAgeSeconds:31536e3})]}),"GET"),e.registerRoute(/^https:\/\/fonts\.(?:googleapis)\.com\/.*/i,new e.StaleWhileRevalidate({cacheName:"google-fonts-stylesheets",plugins:[new e.ExpirationPlugin({maxEntries:4,maxAgeSeconds:604800})]}),"GET"),e.registerRoute(/\.(?:eot|otf|ttc|ttf|woff|woff2|font.css)$/i,new e.StaleWhileRevalidate({cacheName:"static-font-assets",plugins:[new e.ExpirationPlugin({maxEntries:4,maxAgeSeconds:604800})]}),"GET"),e.registerRoute(/\.(?:jpg|jpeg|gif|png|svg|ico|webp)$/i,new e.StaleWhileRevalidate({cacheName:"static-image-assets",plugins:[new e.ExpirationPlugin({maxEntries:64,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\/_next\/image\?url=.+$/i,new e.StaleWhileRevalidate({cacheName:"next-image",plugins:[new e.ExpirationPlugin({maxEntries:64,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\.(?:mp3|wav|ogg)$/i,new e.CacheFirst({cacheName:"static-audio-assets",plugins:[new e.RangeRequestsPlugin,new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\.(?:mp4)$/i,new e.CacheFirst({cacheName:"static-video-assets",plugins:[new e.RangeRequestsPlugin,new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\.(?:js)$/i,new e.StaleWhileRevalidate({cacheName:"static-js-assets",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\.(?:css|less)$/i,new e.StaleWhileRevalidate({cacheName:"static-style-assets",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\/_next\/data\/.+\/.+\.json$/i,new e.StaleWhileRevalidate({cacheName:"next-data",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute(/\.(?:json|xml|csv)$/i,new e.NetworkFirst({cacheName:"static-data-assets",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute((({url:e})=>{if(!(self.origin===e.origin))return!1;const c=e.pathname;return!c.startsWith("/api/auth/")&&!!c.startsWith("/api/")}),new e.NetworkFirst({cacheName:"apis",networkTimeoutSeconds:10,plugins:[new e.ExpirationPlugin({maxEntries:16,maxAgeSeconds:86400})]}),"GET"),e.registerRoute((({request:e,url:{pathname:c},sameOrigin:i})=>"1"===e.headers.get("RSC")&&"1"===e.headers.get("Next-Router-Prefetch")&&i&&!c.startsWith("/api/")),new e.NetworkFirst({cacheName:"pages-rsc-prefetch",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute((({request:e,url:{pathname:c},sameOrigin:i})=>"1"===e.headers.get("RSC")&&i&&!c.startsWith("/api/")),new e.NetworkFirst({cacheName:"pages-rsc",plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute((({url:e})=>{if(!(self.origin===e.origin))return!1;return!e.pathname.startsWith("/api/")}),new e.NetworkFirst({cacheName:"others",networkTimeoutSeconds:10,plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:86400})]}),"GET"),e.registerRoute((({url:e})=>!(self.origin===e.origin)),new e.NetworkFirst({cacheName:"cross-origin",networkTimeoutSeconds:10,plugins:[new e.ExpirationPlugin({maxEntries:32,maxAgeSeconds:3600})]}),"GET")}));
