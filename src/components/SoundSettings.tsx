import type React from "react"
import { Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SoundSettingsProps {
  isMuted: boolean
  toggleMute: () => void
}

export const SoundSettings: React.FC<SoundSettingsProps> = ({ isMuted, toggleMute }) => {
  return (
    <Button variant="ghost" size="icon" className="rounded-full bg-white/50 hover:bg-white/75" onClick={toggleMute}>
      {isMuted ? <VolumeX /> : <Volume2 />}
    </Button>
  )
}

