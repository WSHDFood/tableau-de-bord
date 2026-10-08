# Tableau de bord audience

Google Search Console, Instagram, Facebook et LinkedIn réunis sur une page : une vue d'ensemble, une fiche par site et une fiche par compte.

Pour la mise en ligne et le branchement des sources, suivre **[GUIDE-MISE-EN-SERVICE.md](GUIDE-MISE-EN-SERVICE.md)**. Ce fichier-ci décrit le fonctionnement interne.

## Organisation

| Dossier | Rôle |
|---|---|
| `collect/` | La collecte : interroge les API et écrit `site/data.enc.json`. |
| `collect/sources/` | Une source par fichier : `searchconsole.js`, `meta.js`, `linkedin.js`, et `demo.js` pour les données fictives. |
| `site/` | Le site publié : `index.html`, `styles.css`, `app.js` et le fichier de données chiffré. |
| `.github/workflows/mise-a-jour.yml` | La mise à jour quotidienne et la publication sur GitHub Pages. |
| `test/` | Tests de la collecte sur des API simulées. |
| `config.json` | Renommer, masquer, régler la profondeur d'historique. |

Aucune dépendance à installer : Node.js 20 ou plus suffit, et le site n'appelle aucun service extérieur.

## Commandes

```
npm run collecte   # collecte réelle, selon les clés présentes (.env ou secrets GitHub)
npm run demo       # données de démonstration (mot de passe : demo)
npm run apercu     # sert le site sur http://localhost:4173
npm test           # tests
node collect/index.js --reset   # repart de zéro : efface l'historique enregistré
```

## Clés et réglages

Variables lues par la collecte (voir `.env.example`) :

| Variable | Rôle |
|---|---|
| `DASHBOARD_PASSWORD` | Mot de passe du tableau de bord. Obligatoire dès qu'une source est branchée. |
| `DASHBOARD_PASSWORD_PREVIOUS` | Ancien mot de passe, le temps d'un changement. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_SERVICE_ACCOUNT_FILE` | Clé du compte de service Google (contenu, ou chemin du fichier). |
| `META_ACCESS_TOKEN` | Jeton de l'utilisateur système Meta. |
| `LINKEDIN_ACCESS_TOKEN` | Jeton LinkedIn (60 jours). |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Facultatifs : date d'expiration, et renouvellement si un `LINKEDIN_REFRESH_TOKEN` est fourni. |

`config.json`, par source (`searchConsole`, `meta`, `linkedin`) :

- `exclude` : identifiants à ne pas afficher ;
- `labels` : identifiant → nom affiché ;
- `meta.backfillInstagram` / `meta.backfillFacebook` : jours d'historique demandés à la première collecte (90 et 365 par défaut) ;
- `meta.apiVersion` : version de l'API Graph (`v25.0`). Meta retire chaque version environ deux ans après sa sortie : à relever de temps en temps ;
- `linkedin.apiVersion` : à ne renseigner que pour forcer une version (`AAAAMM`). Par défaut, la collecte cherche seule une version active.

## Comportement de la collecte

- **Découverte automatique.** Toutes les propriétés visibles par le compte de service, toutes les pages et tous les comptes Instagram attribués au jeton Meta, toutes les pages LinkedIn administrées.
- **Historique cumulé.** Chaque exécution relit le fichier existant, y ajoute les nouveaux jours et le réécrit. L'historique finit donc par dépasser ce que les API conservent (16 mois chez Google, 12 mois chez LinkedIn).
- **Collecte incrémentale.** Après la première exécution, seuls les derniers jours sont redemandés (les chiffres récents sont encore corrigés par les plateformes).
- **Pannes isolées.** Une source ou un compte en erreur n'empêche pas les autres ; ses derniers chiffres restent affichés, avec le message d'erreur dans la page Sources.
- **Indicateurs retirés.** Meta supprime régulièrement des indicateurs. Si l'un d'eux est refusé, la collecte continue avec les autres et le signale.
- **Jours Meta.** Meta découpe ses journées à minuit, heure du Pacifique ; la collecte s'aligne dessus.
- **Sans clé ni mot de passe**, la collecte écrit les données de démonstration.

## Fichier de données

`site/data.enc.json` contient les données compressées (gzip) puis chiffrées en AES-256-GCM. La clé est dérivée du mot de passe par PBKDF2-SHA256 (600 000 itérations). Le déchiffrement se fait dans le navigateur (`site/app.js`), avec l'API Web Crypto.

Le fichier est public : sa confidentialité repose entièrement sur la longueur du mot de passe. L'option « Se souvenir de moi » enregistre la clé dérivée dans le navigateur de l'appareil.

Chaque mise à jour ajoute un commit avec le nouveau fichier ; l'historique du dépôt sert ainsi de sauvegarde quotidienne.

## Indicateurs

| Tableau de bord | Instagram | Facebook | LinkedIn |
|---|---|---|---|
| Vues | `views` | `page_media_view` | `impressionCount` |
| Couverture | `reach` | `page_total_media_view_unique` | `uniqueImpressionsCount` |
| Interactions | `total_interactions` | `page_post_engagements` | réactions + commentaires + partages + clics |
| Abonnés | `followers_count` (relevé quotidien) | `page_follows` | `networkSizes`, puis gains quotidiens |

## Ce qui a été vérifié

Les tests (`npm test`) font tourner la collecte complète contre des serveurs simulés dont les réponses reprennent la forme décrite dans la documentation officielle de chaque API (consultée en octobre 2026). Ils ne remplacent pas une première exécution avec de vraies clés : c'est à ce moment-là qu'un écart éventuel avec la documentation apparaîtra, dans la page Sources.
