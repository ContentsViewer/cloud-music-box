"use client"
import {
  createContext,
  Dispatch,
  ReactNode,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react"

export type VisualizerType = "lissajous" | "sparse-cortex"

const VISUALIZER_TYPE_STORAGE_KEY = "visualizerType"

const loadVisualizerType = (): VisualizerType => {
  if (typeof window === "undefined") return "lissajous"
  const value = window.localStorage.getItem(VISUALIZER_TYPE_STORAGE_KEY)
  return value === "sparse-cortex" ? "sparse-cortex" : "lissajous"
}

export interface AudioDynamicsSettingsProps {
  dynamicsEffectAppeal: boolean
  visualizerType: VisualizerType
}

export const AudioDynamicsSettingsStateContext =
  createContext<AudioDynamicsSettingsProps>({
    dynamicsEffectAppeal: false,
    visualizerType: "lissajous",
  })

type AudioDynamicsSettingsAction =
  | {
      type: "setDynamicsEffectAppeal"
      payload: {
        dynamicsEffectAppeal: boolean
      }
    }
  | {
      type: "setVisualizerType"
      payload: {
        visualizerType: VisualizerType
      }
    }

export const AudioDynamicsSettingsDispatchContext = createContext<
  Dispatch<AudioDynamicsSettingsAction>
>(() => {})

export const useAudioDynamicsSettingsStore = () => {
  const state = useContext(AudioDynamicsSettingsStateContext)
  const dispatch = useContext(AudioDynamicsSettingsDispatchContext)
  const refState = useRef(state)
  refState.current = state

  const actions = useMemo(
    () => ({
      setDynamicsEffectAppeal: (dynamicsEffectAppeal: boolean) => {
        dispatch({
          type: "setDynamicsEffectAppeal",
          payload: {
            dynamicsEffectAppeal,
          },
        })
      },
      setVisualizerType: (visualizerType: VisualizerType) => {
        window.localStorage.setItem(VISUALIZER_TYPE_STORAGE_KEY, visualizerType)
        dispatch({
          type: "setVisualizerType",
          payload: {
            visualizerType,
          },
        })
      },
    }),
    []
  )

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
    case "setVisualizerType":
      return {
        ...state,
        visualizerType: action.payload.visualizerType,
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
  const [state, dispatch] = useReducer(reducer, null, () => ({
    dynamicsEffectAppeal: false,
    visualizerType: loadVisualizerType(),
  }))
  return (
    <AudioDynamicsSettingsStateContext.Provider value={state}>
      <AudioDynamicsSettingsDispatchContext.Provider value={dispatch}>
        {children}
      </AudioDynamicsSettingsDispatchContext.Provider>
    </AudioDynamicsSettingsStateContext.Provider>
  )
}
