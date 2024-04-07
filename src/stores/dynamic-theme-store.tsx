'use client'
import { createContext, useContext, useReducer } from "react";

export interface DynamicThemeStateProps {
  pitch: number;
} 

export const DynamicThemeStateContext = createContext<DynamicThemeStateProps>({
  pitch: -1,
});

type Action =
  | { type: "setPitch"; payload: { pitch: number } }

export const DynamicThemeDispatchContext = createContext<React.Dispatch<Action>>(() => { });


export const useDynamicThemeStore = () => {
  const state = useContext(DynamicThemeStateContext);
  const dispatch = useContext(DynamicThemeDispatchContext);

  const actions = {
    setPitch: (pitch: number) => {
      dispatch({ type: "setPitch", payload: { pitch } });
    }
  }
  return [state, actions] as const;
}

const reducer = (state: DynamicThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setPitch":
      // console.log(action.payload.pitch)
      return { ...state, pitch: action.payload.pitch };
    default:
      return state;
  }
}

export const DynamicThemeStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, {
    pitch: -1,
  });

  return (
    <DynamicThemeStateContext.Provider value={state}>
      <DynamicThemeDispatchContext.Provider value={dispatch}>
        {children}
      </DynamicThemeDispatchContext.Provider>
    </DynamicThemeStateContext.Provider>
  );
}