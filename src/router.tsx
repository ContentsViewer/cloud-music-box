"use client"

import React, { createContext, useContext, useReducer } from "react"
import * as NextNavigation from "next/navigation"

interface RouterStateProps {
  currentFileId: string | null
}

export const RouterStateContext = createContext<RouterStateProps>({
  currentFileId: null,
})

type Action = { type: "setFileId"; payload: { fileId: string } }

export const RouterDispatchContext = createContext<(action: Action) => void>(
  () => {}
)

export const useRouter = () => {
  const state = useContext(RouterStateContext)
  const dispatch = useContext(RouterDispatchContext)
  const router = NextNavigation.useRouter()

  const actions = {
    goFile: (fileId: string) => {
      dispatch({ type: "setFileId", payload: { fileId } })
      router.push(`/files#${fileId}`)
    },
  }

  return [state, actions] as const
}

const reducer = (state: RouterStateProps, action: Action): RouterStateProps => {
  switch (action.type) {
    case "setFileId":
      return { ...state, currentFileId: action.payload.fileId }
    default:
      throw new Error("Invalid action")
  }
}

export const RouterProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, {
    currentFileId: null,
  })

  return (
    <RouterStateContext.Provider value={state}>
      <RouterDispatchContext.Provider value={dispatch}>
        {children}
      </RouterDispatchContext.Provider>
    </RouterStateContext.Provider>
  )
}
