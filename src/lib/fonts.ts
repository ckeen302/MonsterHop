import { Fredoka } from "next/font/google"

export const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-fredoka",
})

// Canvas text can't read CSS variables, so it uses the resolved family list
export const GAME_FONT = fredoka.style.fontFamily
