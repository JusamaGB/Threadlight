/* global window */
import { createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useRecordedAgentVoice } from '../../src/renderer/hooks/useRecordedAgentVoice'
function RecordedProof() {
  const voice = useRecordedAgentVoice(true)
  useEffect(() => {
    window.recordedSend = voice.send
  }, [voice.send])
  return createElement('p', null, voice.error ?? voice.draft)
}
createRoot(window.document.getElementById('root')).render(createElement(RecordedProof))
