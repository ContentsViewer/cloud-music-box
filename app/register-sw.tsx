export interface Options {
  onNeedRefresh: (updateSw: () => void) => void
}

export const registerServiceWorker = async (options: Options) => {
  if (!("serviceWorker" in navigator) || window.serwist === undefined) {
    return
  }

  const registration = await window.serwist.register()

  if (!registration) {
    return
  }

  const needsRefresh = (reg: ServiceWorkerRegistration) => {
    const updateSW = () => {
      const { waiting } = reg
      if (waiting) {
        console.log("Sending SKIP_WAITING message to waiting clients")
        waiting.postMessage({ type: 'SKIP_WAITING' })
      }
    }

    options.onNeedRefresh(updateSW)
  }

  // ensure the case when the updatefound event was missed is also handled
  // by re-invoking the prompt when there's a waiting Service Worker
  if (registration.waiting) {
    needsRefresh(registration)
  }

  let firstLoad = false

  registration.addEventListener("updatefound", () => {
    const { installing } = registration
    if (!installing) {
      return
    }

    // wait until the new Service worker is actually installed (ready to take over)
    installing.addEventListener("statechange", () => {
      if (registration.waiting) {
        if (navigator.serviceWorker.controller) {
          // if there's an existing controller (previous Service Worker), show the prompt
          needsRefresh(registration)
        } else {
          firstLoad = true
        }
      }
    })
  })

  let refreshing = false
  // detect controller change and refresh the page
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (firstLoad) {
      firstLoad = false
      return
    }

    if (!refreshing) {
      window.location.reload()
      refreshing = true
    }
  })
}
