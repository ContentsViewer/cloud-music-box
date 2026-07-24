"use client"

import { useRouter } from "@/src/stores/router"
import { useEffect, useRef } from "react"

export default function Page() {
  const [routerState, routerActions] = useRouter()
  const routerActionsRef = useRef(routerActions)
  routerActionsRef.current = routerActions

  useEffect(() => {
    const lastHref = routerActionsRef.current.goLastHref()
    if (!lastHref) {
      routerActionsRef.current.goHome()
    }
  }, [])
  return <></>
}
