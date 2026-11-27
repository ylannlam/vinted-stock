import {useEffect, useId, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {searchCategories} from '../lib/categoryPicker'

function Chevron() {
  return <span aria-hidden="true" className="mx-1 h-2 w-2 shrink-0 rotate-[-45deg] border-b-2 border-r-2 border-[#66847b]"/>
}

function CategoryDialog({index, selected, value, onSelect, onDismiss, loading}) {
  const [branchId, setBranchId] = useState(selected?.children.length ? selected.id : selected?.parent_id)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(50)
  const dialog = useRef(null), heading = useRef(null), list = useRef(null)
  const titleId = useId()
  const branch = index.nodes.get(branchId)
  const searching = Boolean(query.trim())
  const results = useMemo(() => searching ? searchCategories(index, query) : [], [index, query, searching])
  const rows = searching ? results.slice(0, limit) : (branch?.children ?? index.roots)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    heading.current.focus()
    return () => element.close()
  }, [])
  useEffect(() => { list.current.scrollTop = 0 }, [branchId, query])
  function navigate(id) {
    setBranchId(id)
    setQuery('')
    heading.current.focus()
  }
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId}
    onCancel={e => {e.preventDefault(); onDismiss()}}
    onClick={e => {if (e.target === dialog.current) onDismiss()}}
    className="m-auto w-full max-w-none max-h-none bg-transparent p-0 text-[#173b32] backdrop:bg-[#15372f]/45 sm:max-w-lg sm:rounded-2xl">
    <div className="flex h-[100dvh] flex-col bg-white pb-[env(safe-area-inset-bottom)] sm:h-[min(38rem,85dvh)]">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 ref={heading} tabIndex={-1} id={titleId} className="text-lg font-semibold outline-none">Choisir une catégorie</h2>
        <button type="button" className="min-h-11 rounded-lg px-2 text-sm font-semibold text-teal-800 hover:bg-teal-50" onClick={onDismiss}>Fermer</button>
      </header>
      <div className="px-4 pt-3">
        <input aria-label="Rechercher une catégorie" type="search" value={query} placeholder="Rechercher une catégorie"
          className="min-h-11 w-full rounded-xl border border-[#b9cec6] bg-[#f6f9f7] px-3 text-base"
          onChange={e => {setQuery(e.target.value); setLimit(50)}}/>
      </div>
      {searching ? <p role="status" className="px-4 py-3 text-sm text-[#526960]">{results.length} résultat{results.length > 1 ? 's' : ''}</p>
        : <nav aria-label="Chemin de la catégorie" className="flex flex-wrap items-center gap-x-2 border-b px-4 py-1 text-sm">
          {branch ? <><button type="button" className="min-h-10 text-teal-800 underline" onClick={() => navigate(null)}>Toutes les catégories</button>
            {branch.path?.map(node => <span className="inline-flex items-center gap-2" key={node.id}><span aria-hidden="true">›</span>
              {node.id === branch.id ? <strong aria-current="location">{node.title}</strong>
                : <button type="button" className="min-h-10 text-teal-800 underline" onClick={() => navigate(node.id)}>{node.title}</button>}
            </span>)}</> : <strong className="py-2">Toutes les catégories</strong>}
        </nav>}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        {rows.map(node => <button type="button" key={node.id}
          className={'flex min-h-12 w-full items-center justify-between gap-3 border-b px-1 py-3 text-left hover:bg-[#f0f7f3] focus-visible:bg-[#f0f7f3]' + (node.id === value ? ' bg-[#ebf6ef]' : '')}
          onClick={() => node.children.length ? navigate(node.id) : onSelect(node.id)}>
          <span><span className="block font-medium">{node.title}</span>
            {searching && node.path.length > 1 && <span className="block text-sm text-[#526960]">{node.path.slice(0,-1).map(p => p.title).join(' › ')}</span>}
          </span>{node.children.length ? <Chevron/> : node.id === value && <span aria-label="Sélectionnée" className="font-bold text-teal-800">✓</span>}
        </button>)}
        {searching && results.length > limit && <button type="button" className="min-h-11 px-2 font-medium text-teal-800 underline" onClick={() => setLimit(n => n + 50)}>Afficher plus de résultats</button>}
        {!rows.length && <p className="py-5 text-sm text-[#526960]">{loading ? 'Chargement des catégories…' : searching ? 'Aucune catégorie trouvée. Essaie un autre mot.' : 'Aucune catégorie disponible.'}</p>}
      </div>
      {value != null && <footer className="border-t px-4 py-1"><button type="button" className="min-h-11 text-sm text-teal-800 underline" onClick={() => onSelect(null)}>Retirer la catégorie</button></footer>}
    </div>
  </dialog>, document.body)
}

export default function ListingCategoryPicker({index, value, fallbackLabel, onChange, invalid, loading}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef(null)
  const selected = index.nodes.get(value)
  const label = selected?.label || fallbackLabel || (value != null ? 'Catégorie actuelle nº ' + value : 'Choisir une catégorie')
  function dismiss() {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus({preventScroll: true}))
  }
  function select(id) {
    if (value !== id && !trigger.current?.matches(':disabled')) onChange(id)
    dismiss()
  }
  return <><button type="button" ref={trigger} aria-haspopup="dialog" aria-expanded={open}
    aria-label={'Catégorie Vinted · ' + label} aria-invalid={invalid || undefined}
    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-[#b9cec6] bg-white px-3 py-2 text-left disabled:opacity-60"
    onClick={() => setOpen(true)}><span>{label}</span><Chevron/></button>
    {open && <CategoryDialog index={index} value={value} selected={selected} loading={loading} onDismiss={dismiss} onSelect={select}/>}
  </>
}
