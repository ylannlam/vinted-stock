export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topFace" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>
      {/* Face droite */}
      <path d="M32 32 L56 20 L56 46 L32 58 Z" fill="#047857" />
      {/* Face gauche */}
      <path d="M32 32 L8 20 L8 46 L32 58 Z" fill="#059669" />
      {/* Face dessus */}
      <path d="M32 6 L56 18 L32 30 L8 18 Z" fill="url(#topFace)" />
      {/* Ruban vertical avant gauche */}
      <path d="M20 12 L20 38 L32 44 L32 18 Z" fill="#ffffff" fillOpacity="0.15" />
    </svg>
  );
}
