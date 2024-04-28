"use client"
import { createContext, useContext, useReducer } from "react"

export interface DynamicThemeStateProps {
  pitch: number
  rms: number
}

export const DynamicThemeStateContext = createContext<DynamicThemeStateProps>({
  pitch: -1,
  rms: 0,
})

type Action = { type: "setPitchRms"; payload: { pitch: number; rms: number } }

export const DynamicThemeDispatchContext = createContext<
  React.Dispatch<Action>
>(() => {})

export const useDynamicThemeStore = () => {
  const state = useContext(DynamicThemeStateContext)
  const dispatch = useContext(DynamicThemeDispatchContext)

  const actions = {
    setPitchRms: (pitch: number, rms: number) => {
      dispatch({ type: "setPitchRms", payload: { pitch, rms } })
    },
  }
  return [state, actions] as const
}

const reducer = (state: DynamicThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setPitchRms":
      return { ...state, pitch: action.payload.pitch, rms: action.payload.rms }
    default:
      return state
  }
}

export const DynamicThemeStoreProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    pitch: -1,
    rms: 0,
  })

  return (
    <DynamicThemeStateContext.Provider value={state}>
      <DynamicThemeDispatchContext.Provider value={dispatch}>
        {children}
      </DynamicThemeDispatchContext.Provider>
    </DynamicThemeStateContext.Provider>
  )
}
