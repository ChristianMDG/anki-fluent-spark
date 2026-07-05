# Vocab to Anki — Plan de construction

Application complète d'apprentissage anglais pour francophone : fiches IA, leçons immersives, shadowing vidéo (YouTube + upload local), export Anki. Tout persiste indéfiniment en base par utilisateur.

## 1. Backend (Lovable Cloud)

**Auth** : email/mot de passe (activé par défaut). Pas de Google demandé — je m'en tiens à email/password pour rester minimal comme demandé.

**Secret requis** : `GROQ_API_KEY` (je te la demanderai après approbation du plan).

**Tables** (toutes RLS scoped à `auth.uid()`, GRANT authenticated) :
- `cards` — user_id, word, ipa, pos, level, definition, french, grammar, examples, cloze, speaking_q1/a1/q2/a2, exported bool, created_at
- `lessons` — user_id, card_id (FK), content jsonb, created_at (unique par card_id)
- `shadowing_videos` — user_id, source_type ('youtube'|'upload'), youtube_id, storage_path, title, thumbnail_url, duration_seconds, created_at
- `shadowing_notes` — user_id, video_id (FK), word, context, card_id (nullable FK), created_at

**Storage bucket** : `shadowing-videos` (privé, RLS policies par user_id dossier).

**Edge functions** (via TanStack server functions, appelées côté client avec bearer) :
- `generate-vocab-card` : appelle Groq `llama-3.3-70b-versatile` avec le system prompt exact fourni, parse la réponse structurée en champs, insère dans `cards`.
- `generate-full-lesson` : vérifie table `lessons`, sinon appelle Groq (JSON strict, anglais uniquement, retry 1x si JSON invalide), sauve, retourne.

## 2. Frontend — Architecture routes

```
src/routes/
  __root.tsx                     shell + theme + query provider + auth listener
  index.tsx                      redirect vers /auth ou /home selon session
  auth.tsx                       login/signup (public)
  _authenticated/route.tsx       gate (déjà managé)
  _authenticated/home.tsx        dashboard (stats + 2 cartes action)
  _authenticated/generate.tsx    flux mot → fiche
  _authenticated/shadowing.tsx   lecteur + notes + historique
  _authenticated/history.tsx     vue complète historique vidéos
```

Layout partagé (AppShell) : sidebar desktop / bottom nav mobile, header sticky avec compteur export + bouton téléchargement TSV toujours visible.

## 3. Design system — Thème Akatsuki

`src/styles.css` réécrit avec :
- Fond dégradé noir → rouge foncé (#0d0605 → #7a1f16)
- Tokens sémantiques oklch : background, glass-panel, glass-border, crimson (primary), crimson-glow, gold-accent, cream (foreground), muted-cream
- Police corps `system-ui`, mono `ui-monospace` pour labels/badges
- Radius 10-18px, shadows profondes, transitions douces
- Respect `prefers-reduced-motion`
- Classes utilitaires : `.glass-panel`, `.mini-title`, `.answer-highlight`

## 4. Fonctionnalités clés

**Générer** : input mot + niveau optionnel → server fn → fiche affichée grande (definition, french, examples) + boutons "📖 Leçon complète" et "Ajouter à l'export". Liste "Fiches précédentes" repliée en dessous.

**Parsing** partagé (`lib/parse-card.ts`) : détection en-têtes ignorant `(...)`, Grammar → HTML avec mini-titres + puces, Examples → `<ol>`, Cloze → `<ol>` + `<span class="answer-highlight">`, Speaking → 2 paires Q/A.

**Export TSV** : header Anki fixe, colonnes fixes, nom fichier slugifié (`mot.tsv` ou `mot-et-N-autres.tsv`). Toujours accessible depuis header.

**Shadowing** :
- Toggle "Lien YouTube" / "Uploader"
- YouTube : validation regex tolérante, iframe embed API, oEmbed pour titre
- Upload : drop zone + parcourir, .mp4/.webm/.mov, max 200 Mo, upload vers Storage `shadowing-videos/{user_id}/`, lecture `<video>` native
- Contrôles ±5s + play/pause (YT IFrame API ou currentTime natif)
- Insert dans `shadowing_videos` à chaque chargement
- Historique : miniatures scrollables, 15 récentes + "voir tout" → /history avec recherche
- Colonne notes : ajout rapide, ⚡ Générer (crée card + lie card_id), ✕ Supprimer, bouton "Générer toutes (X)" avec progression

**Leçon complète** (modal plein écran mobile / panneau centré desktop) :
- Vérifie cache DB → sinon génère → sauve
- Header sticky (mot, IPA, level, close)
- Barre points de progression cliquable + IntersectionObserver auto-highlight
- Sections : Explanation → Pronunciation → Depending on context (3 puces couleurs) → Synonyms/Antonyms → Related idioms → Common mistakes → Collocations → Reading (surligné + 🔊 Web Speech) → Dialogue (bulles + 🔊) → Speak it out (fond orange) → Quiz (fond rouge, feedback vert/rouge)
- Bouton 🔄 Regenerate en bas

## 5. Ordre d'implémentation

1. Migration DB (tables + RLS + GRANTs) + création bucket storage
2. Design system (styles.css thème Akatsuki)
3. Auth route + gate
4. Server functions (generate-vocab-card, generate-full-lesson) + parsing lib
5. AppShell + navigation + home dashboard
6. Écran Générer + fiche + export TSV
7. Modal Leçon complète (avec cache DB)
8. Écran Shadowing (YouTube + upload + notes + historique)
9. Route /history full view

## Points techniques

- Groq via `fetch` OpenAI-compatible depuis server functions (jamais côté client — protège la clé)
- Toutes les lectures DB dans loaders TanStack Query + `useSuspenseQuery` sous `_authenticated`
- Realtime pas nécessaire (les mutations invalident les queries manuellement)
- Storage RLS : les users ne voient que leur dossier `{user_id}/*`

## Question avant de démarrer

Une seule vraie décision : **Groq API key** — je vais te la demander avec `add_secret` juste après ton approbation. Tu peux l'obtenir gratuitement sur https://console.groq.com/keys.

Prêt à construire ?
