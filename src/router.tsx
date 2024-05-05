"use client"

import React, { createContext, useContext, useEffect, useReducer } from "react"
import * as NextNavigation from "next/navigation"

interface RouterStateProps {
  pathname: string
  hash: string
}

export const RouterStateContext = createContext<RouterStateProps>({
  pathname: "",
  hash: "",
})

type Action = {
  type: "setLocation"
  payload: { pathname: string; hash: string }
}

export const RouterDispatchContext = createContext<(action: Action) => void>(
  () => {}
)

export const useRouter = () => {
  const state = useContext(RouterStateContext)
  const dispatch = useContext(RouterDispatchContext)
  const router = NextNavigation.useRouter()

  const actions = {
    goFile: (fileId: string) => {
      const href = `/files#${encodeURIComponent(fileId)}`
      router.push(href, { scroll: false })
      window.localStorage.setItem("lastHref", href)
    },
    goAlbum: (albumId?: string) => {
      const href = `/albums${albumId ? `#${encodeURIComponent(albumId)}` : ""}`
      router.push(href, { scroll: false })
      window.localStorage.setItem("lastHref", href)
    },
    goHome: () => {
      const href = "/home"
      router.push(href, { scroll: false })
      window.localStorage.setItem("lastHref", href)
    },
    goLastHref: () => {
      const lastHref = window.localStorage.getItem("lastHref")
      if (lastHref) {
        router.push(lastHref, { scroll: false })
      }
      return lastHref
    },
    goSettings: () => {
      const href = "/settings"
      router.push(href, { scroll: false })
    },
    goBack: () => {
      router.back()
    },
    go: (href: string) => {
      router.push(href, { scroll: false })
      window.localStorage.setItem("lastHref", href)
    },
  }

  return [state, actions] as const
}

const reducer = (state: RouterStateProps, action: Action): RouterStateProps => {
  switch (action.type) {
    case "setLocation": {
      const { pathname, hash } = action.payload

      return { ...state, pathname, hash }
    }
    default:
      throw new Error("Invalid action")
  }
}

export const RouterProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, {
    pathname: "",
    hash: "",
  })

  const params = NextNavigation.useParams()
  const pathname = NextNavigation.usePathname()
  useEffect(() => {
    dispatch({
      type: "setLocation",
      payload: {
        pathname: pathname,
        hash: window.location.hash,
      },
    })
  }, [params, pathname])

  return (
    <RouterStateContext.Provider value={state}>
      <RouterDispatchContext.Provider value={dispatch}>
        {children}
      </RouterDispatchContext.Provider>
    </RouterStateContext.Provider>
  )
}
