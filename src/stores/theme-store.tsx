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
  TonalPalette,
  sanitizeDegreesDouble,
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

// Copies from @material/material-color-utilities instead of importing
// `import Variant from '@material/material-color-utilities/scheme/variant';
// Because it's not exported from the package
enum Variant {
  MONOCHROME,
  NEUTRAL,
  TONAL_SPOT,
  VIBRANT,
  EXPRESSIVE,
  FIDELITY,
  CONTENT,
}

interface ThemeStateProps {
  scheme: DynamicScheme
  sourceColor: number
}

const defaultSourceColor = 0x163447
// const defaultSourceColor = 0xFF8D95
const defaultContrastLevel = 0

const DefaultSchemeType = SchemeTonalSpot
// const DefaultSchemeType = SchemeNeutral
// const DefaultSchemeType = SchemeAndroid
// const DefaultSchemeType = SchemeFidelity
// const DefaultSchemeType = SchemeVibrant
// const DefaultSchemeType = SchemeExpressive

function createScheme(sourceColor: number) {
  // return new SchemeTonalSpot(
  //   Hct.fromInt(sourceColor),
  //   true,
  //   defaultContrastLevel
  // )
  const sourceColorHct = Hct.fromInt(sourceColor)
  // console.trace(sourceColor, sourceColorHct.hue, sourceColorHct.chroma, sourceColorHct.tone)
  // console.log(Math.min(sourceColorHct.chroma + 16.0, 36.0))

  // Base SchemeTonalSpot
  // return new DynamicScheme({
  //   sourceColorArgb: sourceColor,
  //   variant: Variant.TONAL_SPOT,
  //   contrastLevel: 0.5,
  //   isDark: true,
  //   primaryPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 36.0),
  //   secondaryPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16.0),
  //   tertiaryPalette: TonalPalette.fromHueAndChroma(
  //     sanitizeDegreesDouble(sourceColorHct.hue + 60.0),
  //     24.0,
  //   ),
  //   neutralPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 6.0),
  //   neutralVariantPalette:
  //     TonalPalette.fromHueAndChroma(sourceColorHct.hue, 8.0),
  // })

  return new DynamicScheme({
    sourceColorArgb: sourceColor,
    variant: Variant.TONAL_SPOT,
    contrastLevel: 0.3,
    isDark: true,
    primaryPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, Math.min(sourceColorHct.chroma + 16.0, 36.0)),
    secondaryPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 16.0),
    tertiaryPalette: TonalPalette.fromHueAndChroma(
      sanitizeDegreesDouble(sourceColorHct.hue + 60.0),
      24.0,
    ),
    neutralPalette: TonalPalette.fromHueAndChroma(sourceColorHct.hue, 6.0),
    neutralVariantPalette:
      TonalPalette.fromHueAndChroma(sourceColorHct.hue, 8.0),
  })
}

const defaultScheme = createScheme(defaultSourceColor)

export const ThemeStateContext = createContext<ThemeStateProps>({
  scheme: defaultScheme,
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
        const scheme = createScheme(sourceColor)
        // console.log(hexFromArgb(sourceColor))
        // console.log("!!",
        //   hexFromArgb(MaterialDynamicColors.primary.getArgb(scheme))
        // )
        dispatch({ type: "setTheme", payload: { scheme, sourceColor } })
      },
      resetSourceColor: () => {
        const scheme = createScheme(defaultSourceColor)
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
    scheme: defaultScheme,
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
