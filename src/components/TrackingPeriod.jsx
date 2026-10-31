export default function TrackingPeriod({period,children}) {
  if(!period?.starts_at)return null
  const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:period.time_zone||'Europe/Paris'}).format(new Date(period.starts_at))
  return <div className="rounded-lg bg-teal-50 border border-teal-100 px-4 py-3 text-sm text-teal-900"><strong>Suivi à partir du {date} à 00 h · heure de Paris.</strong><p className="text-xs mt-1">Les ventes antérieures sont exclues des compteurs et statistiques. {children}</p></div>
}
