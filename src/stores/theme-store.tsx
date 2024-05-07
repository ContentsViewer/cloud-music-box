"use client"

import { Roboto } from "next/font/google"
import { createTheme } from "@mui/material/styles"
import { ThemeProvider } from "@mui/material/styles"
import { useTheme } from "@mui/material/styles"
import {
  hexFromArgb,
  SchemeContent,
  sourceColorFromImage,
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
} from "@material/material-color-utilities"
import { Dispatch, createContext, useContext, useReducer } from "react"
import { GlobalStyles } from "@mui/material"

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
})

interface ThemeStateProps {
  scheme: DynamicScheme
  sourceColor: number
}

const defaultSourceColor = 0x163447

export const ThemeStateContext = createContext<ThemeStateProps>({
  scheme: new SchemeContent(Hct.fromInt(defaultSourceColor), true, 0.3),
  sourceColor: defaultSourceColor,
})

type Action = {
  type: "setTheme"
  payload: { scheme: DynamicScheme; sourceColor: number }
}

export const ThemeDispatchContext = createContext<Dispatch<Action>>(() => {})

export const useThemeStore = () => {
  const state = useContext(ThemeStateContext)
  const dispatch = useContext(ThemeDispatchContext)

  const actions = {
    applyThemeFromImage: async (imageSrc: string) => {
      const image = document.createElement("img")
      image.src = imageSrc
      const sourceColor = await sourceColorFromImage(image)
      const scheme = new SchemeContent(Hct.fromInt(sourceColor), true, 0.3)
      dispatch({ type: "setTheme", payload: { scheme, sourceColor } })
    },
    resetSourceColor: () => {
      const scheme = new SchemeContent(
        Hct.fromInt(defaultSourceColor),
        true,
        0.3
      )
      dispatch({
        type: "setTheme",
        payload: { scheme: scheme, sourceColor: defaultSourceColor },
      })
    },
  }
  return [state, actions] as const
}

const reducer = (state: ThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setTheme":
      const { scheme, sourceColor } = action.payload
      if (state.sourceColor === sourceColor) return state

      // console.log(state.sourceColor, sourceColor)
      return {
        ...state,
        scheme: scheme,
        sourceColor: sourceColor,
      }
    default:
      return state
  }
}

export const ThemeStoreProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [state, dispatch] = useReducer(reducer, {
    scheme: new SchemeContent(Hct.fromInt(defaultSourceColor), true, 0.3),
    sourceColor: defaultSourceColor,
  })

  const theme = createTheme({
    palette: {
      mode: "dark",
      primary: {
        main: hexFromArgb(MaterialDynamicColors.primary.getArgb(state.scheme)),
      },
      secondary: {
        main: hexFromArgb(
          MaterialDynamicColors.secondary.getArgb(state.scheme)
        ),
      },
      background: {
        default: hexFromArgb(
          MaterialDynamicColors.surface.getArgb(state.scheme)
        ),
        paper: hexFromArgb(
          MaterialDynamicColors.surfaceContainer.getArgb(state.scheme)
        ),
      },
      error: {
        main: hexFromArgb(MaterialDynamicColors.error.getArgb(state.scheme)),
      },
      text: {
        primary: hexFromArgb(
          MaterialDynamicColors.onSurface.getArgb(state.scheme)
        ),
      },
    },
    typography: {
      fontFamily: roboto.style.fontFamily,
    },
  })

  // console.log(theme);

  return (
    <ThemeProvider theme={theme}>
      <GlobalStyles
        styles={theme => ({
          body: {
            transition: theme.transitions.create([
              "background-color",
              "transform",
            ]),
          },
        })}
      />
      <ThemeStateContext.Provider value={state}>
        <ThemeDispatchContext.Provider value={dispatch}>
          {children}
        </ThemeDispatchContext.Provider>
      </ThemeStateContext.Provider>
    </ThemeProvider>
  )
}
