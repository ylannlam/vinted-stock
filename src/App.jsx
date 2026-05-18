import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import { CATEGORIES, TAB_TOUT, TAB_A_RECEVOIR, TAB_A_ENVOYER, TAB_A_ENVOYER_LOT, TAB_ENVOYES, TAB_COMPTES_VINTED, TAB_WORKSPACE, TAB_EMPLOYEES, TAB_FONDS } from './constants'
import Login from './Login'
import Header from './components/Header'
import CategoryTabs from './components/CategoryTabs'
import Gallery from './components/Gallery'
import FilterBar from './components/FilterBar'
import LotModal from './components/LotModal'
import AddItemModal from './components/AddItemModal'
import EditItemModal from './components/EditItemModal'
import SoldModal from './components/SoldModal'
import VintedAccountsTab from './components/VintedAccountsTab'
import WorkspaceTab from './components/WorkspaceTab'
import EmployeesTab from './components/EmployeesTab'
import FondsLibrary from './components/FondsLibrary'

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const profileFetchedForRef = useRef(null) // évite les double-fetches
  const [profileLoading, setProfileLoading] = useState(false)
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('activeTab')
    const validTabs = [TAB_TOUT, TAB_A_RECEVOIR, TAB_A_ENVOYER, TAB_A_ENVOYER_LOT, TAB_ENVOYES, TAB_COMPTES_VINTED, TAB_WORKSPACE, TAB_EMPLOYEES, TAB_FONDS]
    return validTabs.includes(saved) ? saved : TAB_TOUT
  })
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [filterSizes, setFilterSizes] = useState([])
  const [filterSearch, setFilterSearch] = useState('')
  const [sortByEmplacement, setSortByEmplacement] = useState(false)
  const [showLotModal, setShowLotModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [soldItem, setSoldItem] = useState(null)

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab)
  }, [activeTab])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null)
      } else if (session?.user) {
        // Évite un re-render si c'est le même utilisateur (ex: TOKEN_REFRESHED)
        setUser(prev => prev?.id === session.user.id ? prev : session.user)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) {
      // Ne fetch le profil qu'une seule fois par utilisateur
      if (profileFetchedForRef.current !== user.id) {
        profileFetchedForRef.current = user.id
        fetchProfile()
      }
    } else {
      profileFetchedForRef.current = null
      setProfile(null)
      setItems([])
    }
  }, [user])

  async function fetchProfile() {
    setProfileLoading(true)
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setProfile(data ?? null)
    setProfileLoading(false)
  }

  useEffect(() => {
    const role = profile?.role
    if (role === 'stock' || role === 'admin') {
      fetchItems()
    }
    // Set default tab for employe
    if (role === 'employe') {
      setActiveTab(TAB_WORKSPACE)
    }
  }, [profile])

  async function fetchItems() {
    setItemsLoading(true)
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setItems(data)
    setItemsLoading(false)
  }

  function handleItemUpdated(updatedItem, newItems = []) {
    setItems(prev => [
      ...newItems,
      ...prev.map(i => i.id === updatedItem.id ? updatedItem : i),
    ])
    setEditItem(null)
  }

  function handleItemAdded(newItems) {
    setItems(prev => [...newItems, ...prev])
    setActiveTab(newItems[0].status === 'a_recevoir' ? TAB_A_RECEVOIR : TAB_TOUT)
    setShowAddModal(false)
  }

  function handleItemSold(updatedItem) {
    setItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i))
    setSoldItem(null)
  }

  async function handleMarkSent(item) {
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'envoye', sent_at: new Date().toISOString(), emplacement: null })
      .eq('id', item.id)
      .select()
      .single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) {
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
      setActiveTab(TAB_ENVOYES)
    }
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('items').delete().eq('id', itemId)
    if (!error) setItems(prev => prev.filter(i => i.id !== itemId))
  }

  async function handleMarkUnsent(item) {
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'vendu', sent_at: null })
      .eq('id', item.id)
      .select()
      .single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleMarkReceived(item) {
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'en_stock' })
      .eq('id', item.id)
      .select()
      .single()
    if (error) { alert('Erreur : ' + error.message); return }
    if (data) {
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
      setActiveTab(TAB_TOUT)
    }
  }

  async function handleBordereauDrop(itemId, file) {
    try {
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const { error: uploadErr } = await supabase.storage.from('bordereaux').upload(fileName, file)
      if (uploadErr) throw uploadErr
      const { data: { publicUrl } } = supabase.storage.from('bordereaux').getPublicUrl(fileName)
      const { data, error: updateErr } = await supabase
        .from('items')
        .update({ bordereau_url: publicUrl })
        .eq('id', itemId)
        .select()
        .single()
      if (updateErr) throw updateErr
      setItems(prev => prev.map(i => i.id === data.id ? data : i))
    } catch (err) {
      console.error('Bordereau upload failed:', err.message)
    }
  }

  async function handleCreateLot(ids, file) {
    try {
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`
      const { error: uploadErr } = await supabase.storage.from('bordereaux').upload(fileName, file)
      if (uploadErr) throw uploadErr
      const { data: { publicUrl } } = supabase.storage.from('bordereaux').getPublicUrl(fileName)
      const { data, error } = await supabase
        .from('items')
        .update({ status: 'vendu', bordereau_url: publicUrl, sold_at: new Date().toISOString() })
        .in('id', ids).select()
      if (error) throw error
      if (data) {
        setItems(prev => prev.map(i => data.find(d => d.id === i.id) ?? i))
        setActiveTab(TAB_A_ENVOYER_LOT)
      }
    } catch (err) {
      alert('Erreur : ' + err.message)
    }
  }

  async function handleLotMarkSent(ids) {
    try {
      const { data, error } = await supabase
        .from('items')
        .update({ status: 'envoye', sent_at: new Date().toISOString(), emplacement: null })
        .in('id', ids).select()
      if (error) throw error
      if (data) {
        setItems(prev => prev.map(i => data.find(d => d.id === i.id) ?? i))
        setActiveTab(TAB_ENVOYES)
      }
    } catch (err) {
      alert('Erreur : ' + err.message)
    }
  }

  async function handleDeleteLot(bordereauUrl) {
    try {
      const { data, error } = await supabase
        .from('items')
        .update({ status: 'en_stock', bordereau_url: null, sold_at: null })
        .eq('bordereau_url', bordereauUrl)
        .select()
      if (error) throw error
      if (data) setItems(prev => prev.map(i => data.find(d => d.id === i.id) ?? i))
    } catch (err) {
      alert('Erreur : ' + err.message)
    }
  }

  async function handleToggleReception(itemId, value) {
    const { data, error } = await supabase
      .from('items').update({ reception_needed: value }).eq('id', itemId).select().single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleUpdateCategory(itemId, newCategory) {
    const { data, error } = await supabase
      .from('items')
      .update({ category: newCategory })
      .eq('id', itemId)
      .select()
      .single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleUpdateEmplacement(itemId, newEmplacement) {
    const { data, error } = await supabase
      .from('items')
      .update({ emplacement: newEmplacement || null })
      .eq('id', itemId)
      .select()
      .single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setItems([])
    setProfile(null)
  }

  // --- Loading state ---
  // N'affiche le chargement que si on n'a pas encore de profil (premier chargement uniquement)
  // Si le profil existe déjà, on reste sur l'interface même pendant un re-fetch silencieux
  if (authLoading || (profileLoading && !profile)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Chargement...
        </div>
      </div>
    )
  }

  if (!user) return <Login />

  // Profile not found
  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Compte non configuré</h2>
          <p className="text-gray-500 text-sm mb-4">Votre compte n'a pas encore été configuré. Contactez votre administrateur.</p>
          <button onClick={handleLogout} className="text-sm text-red-500 hover:text-red-700 font-medium">Se déconnecter</button>
        </div>
      </div>
    )
  }

  const userRole = profile?.role ?? null
  const isAdmin = userRole === 'admin'
  const isEmploye = userRole === 'employe'

  // Employe: show workspace only
  if (isEmploye) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header onLogout={handleLogout} profile={profile} />
        <div className="px-0 py-0">
          <div className="bg-teal-50 border-b border-teal-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-teal-700">Espace de travail</span>
          </div>
          <WorkspaceTab profile={profile} />
        </div>
      </div>
    )
  }

  // Stock / Admin: full UI
  const isSpecialTab = activeTab === TAB_TOUT || activeTab === TAB_A_RECEVOIR || activeTab === TAB_A_ENVOYER || activeTab === TAB_A_ENVOYER_LOT || activeTab === TAB_ENVOYES || activeTab === TAB_COMPTES_VINTED || activeTab === TAB_EMPLOYEES || activeTab === TAB_FONDS

  const filteredItems = (() => {
    if (activeTab === TAB_A_RECEVOIR)    return items.filter(i => i.status === 'a_recevoir')
    if (activeTab === TAB_A_ENVOYER || activeTab === TAB_A_ENVOYER_LOT) {
      const vendus = items.filter(i => i.status === 'vendu')
      const counts = vendus.reduce((acc, i) => {
        if (i.bordereau_url) acc[i.bordereau_url] = (acc[i.bordereau_url] || 0) + 1
        return acc
      }, {})
      const lotBordereaux = new Set(Object.keys(counts).filter(url => counts[url] > 1))
      if (activeTab === TAB_A_ENVOYER)
        return vendus.filter(i => !lotBordereaux.has(i.bordereau_url)).sort((a, b) => new Date(b.sold_at ?? b.created_at) - new Date(a.sold_at ?? a.created_at))
      return vendus.filter(i => i.bordereau_url && lotBordereaux.has(i.bordereau_url)).sort((a, b) => new Date(b.sold_at ?? b.created_at) - new Date(a.sold_at ?? a.created_at))
    }
    if (activeTab === TAB_ENVOYES)       return items.filter(i => i.status === 'envoye')
    const base = items.filter(i => i.status === 'en_stock')
    const searched = base
      .filter(i => filterSizes.length === 0 || filterSizes.includes(i.size))
      .filter(i => {
        if (!filterSearch) return true
        const q = filterSearch.toLowerCase()
        return (i.emplacement ?? '').toLowerCase().includes(q) ||
               (i.category ?? '').toLowerCase().includes(q) ||
               (i.size ?? '').toLowerCase().includes(q)
      })
    if (!sortByEmplacement) return searched
    return [...searched].sort((a, b) => {
      const ea = a.emplacement ?? '￿'
      const eb = b.emplacement ?? '￿'
      return ea.localeCompare(eb, undefined, { numeric: true })
    })
  })()

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onLogout={handleLogout} profile={profile} />
      <CategoryTabs
        categories={CATEGORIES}
        active={activeTab}
        onChange={setActiveTab}
        items={items}
        userRole={userRole}
      />

      {activeTab === TAB_EMPLOYEES && <EmployeesTab />}
      {activeTab === TAB_COMPTES_VINTED && <VintedAccountsTab />}
      {activeTab === TAB_FONDS && <FondsLibrary />}

      {activeTab === TAB_TOUT && (
        <div className="flex items-center justify-end px-3 py-1.5 bg-white border-b border-gray-100">
          <button
            onClick={() => setShowLotModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
          >
            <svg className="w-3.5 h-3.5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Faire un lot
          </button>
        </div>
      )}

      {activeTab === TAB_TOUT && (
        <FilterBar
          sizes={filterSizes}
          onSizesChange={setFilterSizes}
          searchQuery={filterSearch}
          onSearchChange={setFilterSearch}
          sortByEmplacement={sortByEmplacement}
          onSortToggle={() => setSortByEmplacement(v => !v)}
          total={filteredItems.length}
        />
      )}

      {activeTab !== TAB_COMPTES_VINTED && activeTab !== TAB_EMPLOYEES && activeTab !== TAB_FONDS && (
        <Gallery
          items={filteredItems}
          categories={CATEGORIES}
          loading={itemsLoading}
          onMarkSold={setSoldItem}
          onMarkSent={handleMarkSent}
          onMarkUnsent={handleMarkUnsent}
          onMarkReceived={handleMarkReceived}
          onDelete={handleDelete}
          onUpdateCategory={handleUpdateCategory}
          onUpdateEmplacement={handleUpdateEmplacement}
          onBordereauDrop={handleBordereauDrop}
          onEdit={setEditItem}
          onToggleReception={handleToggleReception}
          onLotMarkSent={handleLotMarkSent}
          onDeleteLot={handleDeleteLot}
          isLotTab={activeTab === TAB_A_ENVOYER_LOT}
          showAddHint={!isSpecialTab}
        />
      )}

      {activeTab !== TAB_COMPTES_VINTED && activeTab !== TAB_EMPLOYEES && activeTab !== TAB_FONDS && activeTab !== TAB_A_ENVOYER && activeTab !== TAB_A_ENVOYER_LOT && activeTab !== TAB_ENVOYES && (
        <button
          onClick={() => setShowAddModal(true)}
          className={`fixed bottom-6 right-5 w-14 h-14 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 z-40 ${
            activeTab === TAB_A_RECEVOIR
              ? 'bg-purple-500 hover:bg-purple-600 active:bg-purple-700'
              : 'bg-teal-500 hover:bg-teal-600 active:bg-teal-700'
          }`}
          aria-label="Ajouter un article"
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {showLotModal && (
        <LotModal
          items={items.filter(i => i.status === 'en_stock')}
          onClose={() => setShowLotModal(false)}
          onCreateLot={handleCreateLot}
        />
      )}

      {showAddModal && (
        <AddItemModal
          categories={CATEGORIES}
          defaultCategory={isSpecialTab ? CATEGORIES[0] : activeTab}
          defaultStatus={activeTab === TAB_A_RECEVOIR ? 'a_recevoir' : 'en_stock'}
          onClose={() => setShowAddModal(false)}
          onAdded={handleItemAdded}
        />
      )}

      {editItem && (
        <EditItemModal
          item={editItem}
          categories={CATEGORIES}
          onClose={() => setEditItem(null)}
          onUpdated={handleItemUpdated}
        />
      )}

      {soldItem && (
        <SoldModal
          item={soldItem}
          onClose={() => setSoldItem(null)}
          onSold={handleItemSold}
        />
      )}
    </div>
  )
}
