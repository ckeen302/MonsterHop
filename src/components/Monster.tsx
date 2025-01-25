import { motion } from "framer-motion"

interface MonsterProps {
  x: number
  y: number
  type: "green" | "blue" | "red"
}

export const Monster: React.FC<MonsterProps> = ({ x, y, type }) => {
  const colors = {
    green: "bg-green-500",
    blue: "bg-blue-500",
    red: "bg-red-500",
  }

  return (
    <motion.div
      className={`absolute ${colors[type]} rounded-full w-10 h-10 flex items-center justify-center`}
      style={{ x, y }}
      animate={{ y: y + 10 }}
      transition={{ y: { duration: 0.5, repeat: Number.POSITIVE_INFINITY, repeatType: "reverse" } }}
    >
      <div className="bg-white w-4 h-4 rounded-full relative">
        <div className="absolute bg-black w-2 h-2 rounded-full top-1 left-1" />
      </div>
    </motion.div>
  )
}

