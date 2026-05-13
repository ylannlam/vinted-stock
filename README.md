# Stock Vinted

Application de gestion de stock pour Vinted — React + Vite + Supabase + Tailwind CSS.

---

## Variables d'environnement

| Variable | Description | Où la trouver |
|----------|-------------|---------------|
| `VITE_SUPABASE_URL` | URL de votre projet Supabase | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Clé publique anonyme Supabase | Supabase → Settings → API → anon public |

Copier `.env.example` en `.env` et remplir ces deux valeurs avant de lancer le projet.

---

## Etape 1 — Configurer Supabase

### 1.1 Créer un projet

1. Aller sur [supabase.com](https://supabase.com) → créer un compte (gratuit)
2. Cliquer **New project**, nommer le projet, choisir un mot de passe fort
3. Attendre ~2 minutes que le projet soit prêt

### 1.2 Exécuter le SQL

1. Supabase → **SQL Editor** → **New query**
2. Copier l'intégralité du fichier `supabase-setup.sql`
3. Coller → cliquer **Run**

Ce SQL crée :
- La table `items` avec les 3 statuts (`en_stock`, `vendu`, `envoye`) et la colonne `sent_at`
- La sécurité par ligne (RLS) — accès réservé aux utilisateurs connectés
- Les buckets `photos` (images, max 10 Mo) et `bordereaux` (PDF, max 20 Mo)
- Toutes les policies de stockage

### 1.3 Créer le compte utilisateur

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**
2. Entrer l'email et le mot de passe du compte partagé
3. Valider

### 1.4 Récupérer les clés API

1. Supabase → **Settings** → **API**
2. Copier **Project URL** → `VITE_SUPABASE_URL`
3. Copier **anon public** → `VITE_SUPABASE_ANON_KEY`

---

## Etape 2 — Lancer en local

```bash
npm install

cp .env.example .env
# Remplir .env avec les valeurs Supabase

npm run dev
# Ouvrir http://localhost:5173
```

---

## Etape 3 — Déployer sur Vercel

### 3.1 Pousser sur GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Créer un dépôt sur github.com, puis :
git remote add origin https://github.com/VOTRE_USERNAME/vinted-stock.git
git push -u origin main
```

### 3.2 Importer sur Vercel

1. [vercel.com](https://vercel.com) → **Add New Project** → importer le dépôt GitHub
2. Dans **Environment Variables**, ajouter :

| Nom | Valeur |
|-----|--------|
| `VITE_SUPABASE_URL` | votre URL Supabase |
| `VITE_SUPABASE_ANON_KEY` | votre clé anon Supabase |

3. Cliquer **Deploy** — l'URL de production est disponible en ~1 minute

> Le fichier `vercel.json` inclut déjà la règle de réécriture nécessaire pour le routing SPA (`/* → /index.html`).

---

## Fonctionnalités

**Gestion du stock**
- Connexion email + mot de passe (compte unique partagé)
- 6 catégories en onglets : Jacquard, Motif fleuri, Jaune-Bleu-Violet, Marron-Rouge-Rose, Vert-Noir-Bleu, Petit pois / Top +Autre
- Ajout d'article : glisser-déposer ou sélection de photo + taille (XS/S/M/L/XL/XXL) + catégorie
- Suppression d'article avec confirmation

**Cycle de vie d'un article (3 statuts)**

| Statut | Onglet | Badge | Action disponible |
|--------|--------|-------|-------------------|
| `en_stock` | Catégorie | Blanc — "En stock" | Vendu |
| `vendu` | À envoyer | Orange — "À envoyer" | Déjà envoyé |
| `envoye` | Envoyés | Bleu — "Envoyé" + date | Voir bordereau |

- Clic **Vendu** → upload du bordereau PDF → article passe dans "À envoyer"
- Clic **Déjà envoyé** → article passe dans "Envoyés" avec la date du jour
- Clic **Bordereau** → ouvre le PDF dans un nouvel onglet

---

## Structure du projet

```
vinted-stock/
├── src/
│   ├── components/
│   │   ├── AddItemModal.jsx   # Modal ajout d'article (drag & drop photo)
│   │   ├── CategoryTabs.jsx   # Onglets catégories + À envoyer + Envoyés
│   │   ├── Gallery.jsx        # Grille responsive d'articles
│   │   ├── Header.jsx         # En-tête + déconnexion
│   │   ├── ItemCard.jsx       # Carte article (tous statuts + poubelle)
│   │   └── SoldModal.jsx      # Modal upload bordereau PDF
│   ├── lib/
│   │   └── supabase.js        # Client Supabase
│   ├── constants.js           # Catégories et clés des onglets spéciaux
│   ├── App.jsx                # Orchestration principale
│   ├── Login.jsx              # Page de connexion
│   ├── main.jsx               # Point d'entrée React
│   └── index.css              # Tailwind CSS
├── .env.example               # Modèle des variables d'environnement
├── .gitignore                 # Ignore node_modules, dist, .env
├── supabase-setup.sql         # SQL complet (setup + migration v2)
├── vercel.json                # Rewrites SPA pour Vercel
├── vite.config.js
├── tailwind.config.js
└── package.json
```
