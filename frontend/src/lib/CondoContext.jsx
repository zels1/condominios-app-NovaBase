import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api } from './api'
import { useAuth } from './AuthContext'

const CondoContext = createContext(null)

export function CondoProvider({ children }) {
  const { user } = useAuth()
  const [me, setMe] = useState(null)
  const [condominiums, setCondominiums] = useState([])
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('selectedCondoId') || null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    if (!user) {
      setMe(null); setCondominiums([]); setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [meData, condos] = await Promise.all([api.get('/me'), api.get('/condominiums')])
      setMe(meData)
      setCondominiums(condos)
      setSelectedId((prev) => {
        if (prev && condos.some((c) => c.id === prev)) return prev
        return condos[0]?.id || null
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (selectedId) localStorage.setItem('selectedCondoId', selectedId)
  }, [selectedId])

  const selectedCondo = condominiums.find((c) => c.id === selectedId) || null
  const isAdmin = me?.role === 'admin' || me?.role === 'super_admin'

  return (
    <CondoContext.Provider value={{ me, isAdmin, condominiums, selectedId, setSelectedId, selectedCondo, loading, error, reload }}>
      {children}
    </CondoContext.Provider>
  )
}

export function useCondo() {
  const ctx = useContext(CondoContext)
  if (!ctx) throw new Error('useCondo deve ser usado dentro de <CondoProvider>')
  return ctx
}
