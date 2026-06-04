# LA CLEF DU CENTRE - Facturation v6

Cette version sépare complètement les factures et les devis :

- Module **Factures** séparé
- Module **Devis** séparé
- Archives factures séparées
- Archives devis séparées
- Table Supabase `la_clef_factures`
- Table Supabase `la_clef_devis`
- Nouveau modèle d'impression plus professionnel, compact et optimisé une page

## 1. Lancer en local

Ouvre le dossier dans CMD puis lance :

```cmd
npm install
copy .env.example .env
notepad .env
npm run dev
```

Dans le fichier `.env`, mets les valeurs de ton projet Supabase :

```env
VITE_SUPABASE_URL=https://TON-PROJET.supabase.co
VITE_SUPABASE_ANON_KEY=TA_CLE_ANON_PUBLIC
```

## 2. Créer les tables Supabase

Dans Supabase :

1. SQL Editor
2. New Query
3. Copie tout le contenu du fichier `supabase.sql`
4. Colle dans Supabase
5. Clique sur Run

Le script crée :

- `la_clef_company_settings`
- `la_clef_factures`
- `la_clef_devis`
- `la_clef_billing_counters`

Si tu avais déjà utilisé l'ancienne table unique, le script essaye aussi de transférer les anciens documents vers les nouvelles tables séparées.

## 3. GitHub

```cmd
git init
git add .
git commit -m "version facturation v6"
git branch -M main
git remote add origin TON_LIEN_GITHUB
git push -u origin main
```

## 4. Render

Créer un **Static Site** puis mettre :

- Build Command : `npm install && npm run build`
- Publish Directory : `dist`

Dans **Environment**, ajouter :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`


## Version v4 - Impression couleur, PDF et 

Cette version ajoute :
- l'impression avec couleurs forcées (`print-color-adjust: exact`) ;
- le bouton `Télécharger PDF` pour les factures et les devis ;
- le bouton `Envoyer ` qui ouvre  avec un message préparé pour le client ;
- le PDF peut ensuite être joint manuellement dans  si tu veux envoyer le document complet.

Si Chrome imprime encore sans couleurs, dans la fenêtre d'impression clique sur `Plus de paramètres`, puis active `Graphiques d'arrière-plan`.

Après remplacement du dossier, relance :

```cmd
npm install
npm run dev
```

Supabase ne change pas entre la v3 et la v4 : si tu as déjà collé le SQL de la v3, tu n'as pas besoin de le refaire.


## Version 5
- Nouveau modèle facture/devis plus compact et professionnel.
- Impression optimisée pour éviter une deuxième page vide quand le contenu tient sur une seule page.
- Export PDF optimisé avec une classe d'export dédiée.


## Version 6
- Correction du bouton Télécharger PDF : l'export ne dépend plus du rendu écran html2canvas.
- Génération PDF directe et plus fiable avec jsPDF.
- Le PDF reste sur une seule page quand le contenu tient sur une seule page, puis ajoute une page seulement si nécessaire.
- Les couleurs du modèle sont directement dessinées dans le PDF.
