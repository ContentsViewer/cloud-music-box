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
      router.push(`/files#${fileId}`)
    },
    goHome: () => {
      router.push("/home")
    }
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
