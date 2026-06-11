import { useState, useEffect } from 'react'

/**
 * useState dont la valeur est conservée dans localStorage.
 * Au montage, lit la valeur enregistrée (sinon `defaultValue`) ; à chaque
 * changement, la réécrit. Tolère les Set/array via JSON.
 *
 * @param {string} key   clé localStorage (unique par état)
 * @param {*} defaultValue valeur initiale si rien n'est enregistré
 */
export function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return defaultValue
      return JSON.parse(raw)
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // quota dépassé ou navigation privée : on ignore silencieusement
    }
  }, [key, value])

  return [value, setValue]
}
