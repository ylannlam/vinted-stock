import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { CATEGORIES, TAB_A_ENVOYER, TAB_ENVOYES } from './constants'
import Login from './Login'
import Header from './components/Header'
import CategoryTabs from './components/CategoryTabs'
import Gallery from './components/Gallery'
import AddItemModal from './components/AddItemModal'
import SoldModal from './components/SoldModal'

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(CATEGORIES[0])
  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [soldItem, setSoldItem] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) fetchItems()
  }, [user])

  async function fetchItems() {
    setItemsLoading(true)
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false })
    if (!error && data) setItems(data)
    setItemsLoading(false)
  }

  function handleItemAdded(newItem) {
    setItems(prev => [newItem, ...prev])
    setActiveTab(newItem.category)
    setShowAddModal(false)
  }

  function handleItemSold(updatedItem) {
    setItems(prev => prev.map(i => i.id === updatedItem.id ? updatedItem : i))
    setSoldItem(null)
  }

  async function handleMarkSent(item) {
    const { data, error } = await supabase
      .from('items')
      .update({ status: 'envoye', sent_at: new Date().toISOString() })
      .eq('id', item.id)
      .select()
      .single()
    if (!error && data) setItems(prev => prev.map(i => i.id === data.id ? data : i))
  }

  async function handleDelete(itemId) {
    const { error } = await supabase.from('items').delete().eq('id', itemId)
    if (!error) setItems(prev => prev.filter(i => i.id !== itemId))
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setItems([])
  }

  if (authLoading) {
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

  const isSpecialTab = activeTab === TAB_A_ENVOYER || activeTab === TAB_ENVOYES

  const filteredItems =
    activeTab === TAB_A_ENVOYER ? items.filter(i => i.status === 'vendu') :
    activeTab === TAB_ENVOYES   ? items.filter(i => i.status === 'envoye') :
    items.filter(i => i.category === activeTab && i.status === 'en_stock')

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onLogout={handleLogout} />
      <CategoryTabs
        categories={CATEGORIES}
        active={activeTab}
        onChange={setActiveTab}
        items={items}
      />
      <Gallery
        items={filteredItems}
        loading={itemsLoading}
        onMarkSold={setSoldItem}
        onMarkSent={handleMarkSent}
        onDelete={handleDelete}
        showAddHint={!isSpecialTab}
      />

      {!isSpecialTab && (
        <button
          onClick={() => setShowAddModal(true)}
          className="fixed bottom-6 right-5 w-14 h-14 bg-teal-500 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-teal-600 active:bg-teal-700 transition-all hover:scale-105 z-40"
          aria-label="Ajouter un article"
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {showAddModal && (
        <AddItemModal
          categories={CATEGORIES}
          onClose={() => setShowAddModal(false)}
          onAdded={handleItemAdded}
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
