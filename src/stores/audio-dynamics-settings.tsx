"use client"
import {
  createContext,
  Dispatch,
  ReactNode,
  useContext,
  useReducer,
} from "react"

export interface AudioDynamicsSettingsProps {
  dynamicsEffectAppeal: boolean
}

export const AudioDynamicsSettingsStateContext =
  createContext<AudioDynamicsSettingsProps>({
    dynamicsEffectAppeal: false,
  })

type AudioDynamicsSettingsAction = {
  type: "setDynamicsEffectAppeal"
  payload: {
    dynamicsEffectAppeal: boolean
  }
}

export const AudioDynamicsSettingsDispatchContext = createContext<
  Dispatch<AudioDynamicsSettingsAction>
>(() => {})

export const useAudioDynamicsSettingsStore = () => {
  const state = useContext(AudioDynamicsSettingsStateContext)
  const dispatch = useContext(AudioDynamicsSettingsDispatchContext)
  const actions = {
    setDynamicsEffectAppeal: (dynamicsEffectAppeal: boolean) => {
      dispatch({
        type: "setDynamicsEffectAppeal",
        payload: {
          dynamicsEffectAppeal,
        },
      })
    },
  }
  return [state, actions] as const
}

const reducer = (
  state: AudioDynamicsSettingsProps,
  action: AudioDynamicsSettingsAction
): AudioDynamicsSettingsProps => {
  switch (action.type) {
    case "setDynamicsEffectAppeal":
      return {
        ...state,
        dynamicsEffectAppeal: action.payload.dynamicsEffectAppeal,
      }
    default:
      return state
  }
}

export const AudioDynamicsSettingsProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    dynamicsEffectAppeal: false,
  })
  return (
    <AudioDynamicsSettingsStateContext.Provider value={state}>
      <AudioDynamicsSettingsDispatchContext.Provider value={dispatch}>
        {children}
      </AudioDynamicsSettingsDispatchContext.Provider>
    </AudioDynamicsSettingsStateContext.Provider>
  )
}
