"use client"
import { createContext, useContext, useReducer } from "react"

export interface AudioFrame {
  timeSeconds: number
  pitch0: number
  pitch1: number
  rms0: number
  rms1: number
  samples0: Float32Array
  samples1: Float32Array
}

export interface AudioDynamicsStateProps {
  frame: AudioFrame
}

export const AudioDynamicsStateContext = createContext<AudioDynamicsStateProps>({
  frame: {
    timeSeconds: 0,
    pitch0: -1,
    pitch1: -1,
    rms0: 0,
    rms1: 0,
    samples0: new Float32Array(0),
    samples1: new Float32Array(0),
  },
})

type Action = {
  type: "setFrame"
  payload: {
    frame: AudioFrame
  }
}

export const AudioDynamicsDispatchContext = createContext<
  React.Dispatch<Action>
>(() => {})

export const useAudioDynamicsStore = () => {
  const state = useContext(AudioDynamicsStateContext)
  const dispatch = useContext(AudioDynamicsDispatchContext)

  const actions = {
    setFrame: (frame: AudioFrame) => {
      dispatch({
        type: "setFrame",
        payload: {
          frame,
        },
      })
    },
  }
  return [state, actions] as const
}

const reducer = (state: AudioDynamicsStateProps, action: Action) => {
  switch (action.type) {
    case "setFrame":
      return {
        ...state,
        frame: action.payload.frame,
      }
    default:
      return state
  }
}

export const AudioDynamicsProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    frame: {
      timeSeconds: 0,
      pitch0: -1,
      pitch1: -1,
      rms0: 0,
      rms1: 0,
      samples0: new Float32Array(0),
      samples1: new Float32Array(0),
    },
  })

  return (
    <AudioDynamicsStateContext.Provider value={state}>
      <AudioDynamicsDispatchContext.Provider value={dispatch}>
        {children}
      </AudioDynamicsDispatchContext.Provider>
    </AudioDynamicsStateContext.Provider>
  )
}
