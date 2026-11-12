import React from 'react'
import { createPortal } from 'react-dom'
import { useScrum } from '../lib/scrumState'

/**
 * The summary cards of a tab, drawn in the corner of the tab bar instead of in
 * a row of their own. Every tab stays mounted, so only the one that is showing
 * puts its cards there.
 */
export default function TabStats({ id, children }) {
  const { activeTab, statsSlot } = useScrum()
  if (!statsSlot || activeTab !== id) return null
  return createPortal(<div className="pm-root tab-stats">{children}</div>, statsSlot)
}
