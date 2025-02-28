"use client"

import { Roboto, Noto_Sans_JP } from "next/font/google"
import { createTheme, responsiveFontSizes } from "@mui/material/styles"
import { ThemeProvider } from "@mui/material/styles"
import { useTheme } from "@mui/material/styles"
import {
  hexFromArgb,
  sourceColorFromImage,
  DynamicScheme,
  Hct,
  MaterialDynamicColors,
  rgbaFromArgb,
  SchemeTonalSpot,
  SchemeFidelity,
  SchemeExpressive,
  SchemeVibrant,
  SchemeAndroid,
  SchemeNeutral,
} from "@material/material-color-utilities"
import {
  Dispatch,
  createContext,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react"
import { GlobalStyles } from "@mui/material"
import { extractColorFromImage } from "../theming/color-from-image"

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
})
const notoSans = Noto_Sans_JP({
  weight: ["300", "400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
})

interface ThemeStateProps {
  scheme: DynamicScheme
  sourceColor: number
}

const defaultSourceColor = 0x163447
// const defaultSourceColor = 0xFF8D95
const defaultContrastLevel = 0.6

const DefaultSchemeType = SchemeTonalSpot
// const DefaultSchemeType = SchemeNeutral
// const DefaultSchemeType = SchemeAndroid
// const DefaultSchemeType = SchemeFidelity
// const DefaultSchemeType = SchemeVibrant
// const DefaultSchemeType = SchemeExpressive


export const ThemeStateContext = createContext<ThemeStateProps>({
  scheme: new DefaultSchemeType(
    Hct.fromInt(defaultSourceColor),
    true,
    defaultContrastLevel
  ),
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
  const refState = useRef(state)
  refState.current = state

  const actions = useMemo(() => {
    return {
      applyThemeFromImage: async (blob: Blob) => {
        const sourceColor = await extractColorFromImage(blob)
        // console.log(rgbaFromArgb(sourceColor))
        const scheme = new DefaultSchemeType(
          Hct.fromInt(sourceColor),
          true,
          defaultContrastLevel
        )
        // console.log(hexFromArgb(sourceColor))
        // console.log("!!", 
        //   hexFromArgb(MaterialDynamicColors.primary.getArgb(scheme))
        // )
        dispatch({ type: "setTheme", payload: { scheme, sourceColor } })
      },
      resetSourceColor: () => {
        const scheme = new DefaultSchemeType(
          Hct.fromInt(defaultSourceColor),
          true,
          defaultContrastLevel
        )
        dispatch({
          type: "setTheme",
          payload: { scheme: scheme, sourceColor: defaultSourceColor },
        })
      },
    }
  }, [])

  return [state, actions] as const
}

const reducer = (state: ThemeStateProps, action: Action) => {
  switch (action.type) {
    case "setTheme":
      const { scheme, sourceColor } = action.payload
      if (state.sourceColor === sourceColor) return state

      // console.log(sourceColor, scheme)
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
    scheme: new DefaultSchemeType(
      Hct.fromInt(defaultSourceColor),
      true,
      defaultContrastLevel
    ),
    sourceColor: defaultSourceColor,
  })

  const theme = responsiveFontSizes(
    createTheme({
      palette: {
        mode: "dark",
        primary: {
          main: hexFromArgb(
            MaterialDynamicColors.primary.getArgb(state.scheme)
          ),
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
        fontFamily: notoSans.style.fontFamily,
      },
    })
  )

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
